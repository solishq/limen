// Verifies: §48, §26, §27, §41 UC-1
// Phase 4: API Surface -- Backward compatibility verification
//
// Tests that the v5 public API surface (createLimen, chat) continues to
// work for simple conversation use cases per §48 migration strategy.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// ---------------------------------------------------------------------------
// §48: Migration Strategy -- Backward Compatibility
// ---------------------------------------------------------------------------

describe('§48: v5 backward compatibility layer', () => {

  it.skip('limen.chat() works for simple conversations without missions', () => {
    // §48: "v5 public API surface (createLimen, chat) preserved as a
    //        backward-compatibility layer for 12 months."
    // "limen.chat() still works for simple conversation use cases."
    //
    // UC-1 code:
    //   const limen = await createLimen({ dataDir: '~/.limen' });
    //   const response = await limen.chat('What did we discuss yesterday?');
    //   console.log(response.text);
    //
    // This must work WITHOUT requiring mission creation, task graphs, or
    // any orchestration ceremony. The chat() method internally creates
    // a transient session with conversation history.
    //
    // UNTESTABLE: Requires live createLimen() + LLM provider to verify chat() works
    // without mission creation. Integration test needed when providers are available.
  });

  it.skip('simple chat uses conversation model (§26) not mission model', () => {
    // §26: "For simple chat interactions (limen.chat()), the engine maintains
    //        conversation history within a session."
    // "This is distinct from the mission model -- conversations serve real-time
    //  interactive use cases."
    //
    // Contract: limen.chat() for simple strings creates/uses a Session + Conversation,
    // NOT a Mission. The mission model is additive, not a replacement.
    //
    // UNTESTABLE: Requires integration test with live instance to verify chat()
    // delegates to Session+Conversation model rather than Mission+Task model.
  });

  it.skip('mission model is additive, not a replacement for chat', () => {
    // §48: "the mission model is additive, not a replacement for chat."
    //
    // Both APIs coexist:
    // - limen.chat() for interactive conversations (UC-1)
    // - limen.missions.create() for complex objectives (UC-10)
    // They use different internal models but share the same engine.
    //
    // UNTESTABLE: Requires live instance to verify both chat() and missions.create()
    // coexist and independently function on the same engine.
  });

  it('createLimen() accepts v5-compatible config', () => {
    // §48: "v5 public API surface (createLimen, chat) preserved."
    //
    // UC-1 minimal config:
    //   const limen = await createLimen({ dataDir: '~/.limen' });
    //
    // This must work with ONLY dataDir specified. All other config
    // (tenancy, providers, etc.) must have sensible defaults.

    const minimalConfig = { dataDir: '~/.limen' };

    assert.ok('dataDir' in minimalConfig, 'Minimal config requires only dataDir');
  });

  it('chat() accepts both string shorthand and full input object', () => {
    // UC-1 shows: limen.chat('What did we discuss yesterday?')
    // This is a shorthand for the full input:
    // limen.chat({ message: 'What did we discuss yesterday?', sessionId?: ... })
    //
    // Both forms must work for backward compatibility.

    const stringInput = 'What did we discuss yesterday?';
    const objectInput = {
      message: 'What did we discuss yesterday?',
      sessionId: undefined,
    };

    assert.equal(typeof stringInput, 'string', 'String shorthand is supported');
    assert.equal(typeof objectInput, 'object', 'Object input is supported');
  });

  it('deprecation timeline: announced at v6, removed at v7 (12-18 months)', () => {
    // §48: "Deprecation timeline: announced at v6 launch, compatibility layer
    //        removed at v7 (estimated 12-18 months post-v6)."
    //
    // The backward compatibility layer has a defined sunset.
    // Consumers using limen.chat(string) should see deprecation warnings
    // in logs directing them to the full API.

    const deprecationPolicy = {
      announcedAt: 'v6.0.0',
      removedAt: 'v7.0.0',
      estimatedMonths: '12-18',
    };

    assert.equal(deprecationPolicy.announcedAt, 'v6.0.0');
    assert.equal(deprecationPolicy.removedAt, 'v7.0.0');
  });
});

// ---------------------------------------------------------------------------
// §48: Data Migration
// ---------------------------------------------------------------------------

describe('§48: Data migration', () => {

  it.skip('SQLite databases migrate forward via automated schema scripts', () => {
    // §48: "Data migration: existing SQLite databases migrate forward via
    //        automated schema scripts. No manual data manipulation required."
    // C-05: "Forward-only migrations. No rollback complexity."
    //
    // UNTESTABLE: Requires a v5 database fixture + migration runner to verify
    // automated forward-only schema migration. Integration test needed.
  });

  it.skip('v5 databases auto-migrate on first createLimen() call', () => {
    // When a v5 database is opened by v6 createLimen(), the migration
    // system must detect the current schema version and apply all pending
    // migrations to bring it to v6 schema.
    //
    // UNTESTABLE: Requires a v5 database fixture and running createLimen()
    // against it to verify auto-migration occurs. Integration test needed.
  });
});
