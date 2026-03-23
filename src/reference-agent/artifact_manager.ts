/**
 * ArtifactManager -- workspace management for artifacts.
 * S ref: S18 (create_artifact), S19 (read_artifact),
 *        SD-01 (lifecycle-phase grouping)
 *
 * Phase: 5 (Reference Agent)
 * Implements: SDD §10 Build Order Step 3 (ArtifactManager)
 *
 * The ArtifactManager is responsible for:
 *   1. Creating artifacts via SC-4 (create_artifact)
 *   2. Reading artifacts via SC-5 (read_artifact)
 *   3. Tracking artifact IDs for result submission
 *   4. Managing artifact versioning (parentArtifactId for revisions)
 *
 * I-19: The manager never mutates artifacts after creation. Revisions
 * create new versions via parentArtifactId, not by modifying existing ones.
 *
 * I-23: All reads go through read_artifact, creating proper dependency edges.
 * The manager never caches content to bypass dependency tracking.
 *
 * Invariants enforced: I-19 (artifact immutability),
 *                      I-21 (reads only ACTIVE artifacts),
 *                      I-23 (dependency tracking via read_artifact)
 * Failure modes defended: FM-15 (artifact entropy -- purposeful creation)
 */

import type {
  MissionId, TaskId, ArtifactId,
  ArtifactCreateInput, ArtifactCreateOutput,
  ArtifactReadInput, ArtifactReadOutput,
  AgentExecutionState,
} from './reference_agent.types.js';

import { SystemCallClient } from './system_call_client.js';

// ============================================================================
// ArtifactManager Class
// ============================================================================

/**
 * SD-01: ArtifactManager groups create_artifact + read_artifact.
 * These are the "workspace" calls that manage OUTPUT during execution.
 *
 * FM-15 defense: The manager creates artifacts purposefully:
 *   - One artifact per task output (not duplicates)
 *   - Uses parentArtifactId for revisions (not new entries)
 *   - Reads only ACTIVE artifacts (I-21)
 */
export class ArtifactManager {
  private readonly client: SystemCallClient;

  constructor(client: SystemCallClient) {
    this.client = client;
  }

  /**
   * §18, SC-4: Create an artifact from task output.
   *
   * I-19: Once created, the artifact is immutable. Revisions create
   * new versions via parentArtifactId.
   *
   * FM-15: Creates one artifact per task output. Does not create
   * duplicates or unnecessary artifacts.
   *
   * @param missionId - The mission this artifact belongs to
   * @param name - Descriptive name for the artifact
   * @param type - Artifact type (report, data, code, analysis, image, raw)
   * @param format - Content format (markdown, json, csv, python, sql, html)
   * @param content - The artifact content
   * @param sourceTaskId - The task that produced this artifact
   * @param parentArtifactId - Parent artifact for revisions (null for new)
   * @param metadata - Additional metadata
   * @param state - Agent execution state (for tracking)
   * @returns ArtifactCreateOutput with artifactId and version
   */
  async createArtifact(
    missionId: MissionId,
    name: string,
    type: 'report' | 'data' | 'code' | 'analysis' | 'image' | 'raw',
    format: 'markdown' | 'json' | 'csv' | 'python' | 'sql' | 'html',
    content: string | Buffer,
    sourceTaskId: string,
    parentArtifactId: ArtifactId | undefined,
    metadata: Record<string, unknown>,
    state: AgentExecutionState,
  ): Promise<ArtifactCreateOutput> {
    const input: ArtifactCreateInput = {
      missionId,
      name,
      type,
      format,
      content,
      sourceTaskId: sourceTaskId as TaskId,
      ...(parentArtifactId != null ? { parentArtifactId } : {}),
      metadata,
    };

    const result = await this.client.createArtifact(input);

    // Track artifact for result submission
    state.completedArtifactIds.push(result.artifactId);

    return result;
  }

  /**
   * §19, SC-5: Read an artifact.
   *
   * I-23: This call creates a dependency edge from the reading mission
   * to the artifact. The system uses these edges for invalidation cascading.
   * The agent NEVER caches artifact content to bypass this tracking.
   *
   * I-21: The agent reads only ACTIVE artifacts. SUMMARIZED and ARCHIVED
   * artifacts are excluded from the working set.
   *
   * @param artifactId - The artifact to read
   * @param version - Specific version or 'latest'
   * @returns ArtifactReadOutput with full artifact content
   */
  async readArtifact(
    artifactId: ArtifactId,
    version: number | 'latest' = 'latest',
  ): Promise<ArtifactReadOutput> {
    const input: ArtifactReadInput = {
      artifactId,
      version,
    };

    return this.client.readArtifact(input);
  }

  /**
   * §18: Create a task output artifact with standard metadata.
   *
   * Convenience method that creates an artifact with task execution metadata
   * automatically attached. One artifact per task output (FM-15).
   *
   * @param missionId - Mission context
   * @param taskId - Task that produced this output
   * @param taskDescription - Description of what the task did
   * @param content - The output content
   * @param state - Agent execution state
   * @returns ArtifactCreateOutput
   */
  async createTaskOutput(
    missionId: MissionId,
    taskId: string,
    taskDescription: string,
    content: string,
    state: AgentExecutionState,
  ): Promise<ArtifactCreateOutput> {
    return this.createArtifact(
      missionId,
      `Output: ${taskDescription}`,
      'analysis',
      'markdown',
      content,
      taskId,
      undefined,
      { producedBy: 'reference-agent', taskDescription },
      state,
    );
  }

  /**
   * §18: Create a final report artifact.
   *
   * @param missionId - Mission context
   * @param taskId - The delivery task that produced the report
   * @param title - Report title
   * @param content - Report content
   * @param state - Agent execution state
   * @returns ArtifactCreateOutput
   */
  async createReport(
    missionId: MissionId,
    taskId: string,
    title: string,
    content: string,
    state: AgentExecutionState,
  ): Promise<ArtifactCreateOutput> {
    return this.createArtifact(
      missionId,
      title,
      'report',
      'markdown',
      content,
      taskId,
      undefined,
      { producedBy: 'reference-agent', isDeliverable: true },
      state,
    );
  }

  /**
   * §18, I-19: Revise an existing artifact by creating a new version.
   *
   * Does NOT modify the original. Creates a new version linked via
   * parentArtifactId (I-19: immutability).
   *
   * @param missionId - Mission context
   * @param parentArtifactId - The artifact being revised
   * @param name - Updated name
   * @param type - Artifact type
   * @param format - Content format
   * @param content - Updated content
   * @param sourceTaskId - Task producing the revision
   * @param state - Agent execution state
   * @returns ArtifactCreateOutput for the new version
   */
  async reviseArtifact(
    missionId: MissionId,
    parentArtifactId: ArtifactId,
    name: string,
    type: 'report' | 'data' | 'code' | 'analysis' | 'image' | 'raw',
    format: 'markdown' | 'json' | 'csv' | 'python' | 'sql' | 'html',
    content: string | Buffer,
    sourceTaskId: string,
    state: AgentExecutionState,
  ): Promise<ArtifactCreateOutput> {
    return this.createArtifact(
      missionId,
      name,
      type,
      format,
      content,
      sourceTaskId,
      parentArtifactId,
      { producedBy: 'reference-agent', isRevision: true },
      state,
    );
  }
}
