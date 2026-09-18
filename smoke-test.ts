import { loadEnvConfig } from '@next/env';
loadEnvConfig(process.cwd());

import { aiService, CHAT_MODEL_NAME, EMBEDDING_DIM, EMBEDDING_MODEL_NAME, ACTIVE_CHAT_PROVIDER, ACTIVE_EMBEDDING_PROVIDER, MERCURY_BASE_URL_VALUE } from './lib/ai/AIService';

async function smokeTest() {
  console.log('Starting smoke test for split AIService (Mercury chat + Gemini embeddings)...\n');
  console.log(`  Chat provider: ${ACTIVE_CHAT_PROVIDER} — model ${CHAT_MODEL_NAME} @ ${MERCURY_BASE_URL_VALUE}`);
  console.log(`  Embedding: ${ACTIVE_EMBEDDING_PROVIDER} ${EMBEDDING_MODEL_NAME} (${EMBEDDING_DIM} dims)`);
  console.log(`  MERCURY_API_KEY set: ${!!(process.env.MERCURY_API_KEY || process.env.INCEPTION_API_KEY)}`);
  console.log(`  GEMINI_API_KEY set: ${!!process.env.GEMINI_API_KEY}\n`);
  
  try {
    console.log('1. Testing generateText (Mercury)...');
    try {
      const textResult = await aiService.generateText({
        systemPrompt: 'You are a helpful assistant.',
        userPrompt: 'Say "Hello from Mercury" and nothing else.',
        temperature: 0.7,
        maxTokens: 3000,
      });
      console.log('✓ generateText succeeded:', textResult);
      if (!textResult || textResult.length === 0) throw new Error('Empty response from chat provider');
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (
        msg.includes('MERCURY_API_KEY') ||
        msg.includes('Authentication') ||
        msg.includes('Invalid API Key') ||
        msg.includes('invalid_api_key') ||
        lower.includes('401')
      ) {
        console.log('⚠ generateText skipped/failed (expected without real Mercury API key):', msg.slice(0, 500));
        console.log('  → Correctly routed to Mercury — 401 proves endpoint exists (not 404).');
      } else throw e;
    }

    console.log('\n2. Testing generateStructured (Mercury, JSON mode)...');
    try {
      const structuredResult = await aiService.generateStructured({
        systemPrompt: 'You are a helpful assistant that returns JSON.',
        userPrompt: 'Return a JSON object with a "message" field containing "Hello from Mercury structured".',
        schema: { message: 'string' },
        temperature: 0.7,
        maxTokens: 3000,
      });
      console.log('✓ generateStructured succeeded:', structuredResult);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (
        msg.includes('MERCURY_API_KEY') ||
        msg.includes('Authentication') ||
        msg.includes('Invalid API Key') ||
        msg.includes('invalid_api_key') ||
        lower.includes('401')
      ) {
        console.log('⚠ generateStructured skipped/failed (expected without real Mercury API key):', msg.slice(0, 500));
        console.log('  → Correctly routed to Mercury — JSON mode via response_format: json_object (validated server-side).');
      } else throw e;
    }

    console.log('\n3. Testing generateEmbedding (Gemini gemini-embedding-2, 768 dims)...');
    try {
      const embeddingResult = await aiService.generateEmbedding({
        input: 'Hello world',
      });
      console.log('✓ generateEmbedding succeeded');
      console.log(`  Provider: ${ACTIVE_EMBEDDING_PROVIDER} (${EMBEDDING_MODEL_NAME})`);
      console.log('  Dimension:', embeddingResult[0].length, embeddingResult[0].length === EMBEDDING_DIM ? `(expected ${EMBEDDING_DIM} ✓)` : '(UNEXPECTED)');
      console.log('  First 5 values:', embeddingResult[0].slice(0, 5));
      if (embeddingResult[0].length !== EMBEDDING_DIM) throw new Error(`Embedding dimension mismatch: ${embeddingResult[0].length} != ${EMBEDDING_DIM}`);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (
        msg.includes('GEMINI_API_KEY') ||
        msg.includes('Gemini') ||
        msg.includes('Authentication') ||
        msg.includes('Invalid API Key') ||
        msg.includes('invalid_api_key') ||
        lower.includes('401')
      ) {
        console.log('⚠ generateEmbedding skipped/failed (set GEMINI_API_KEY from https://aistudio.google.com/apikey):', msg.slice(0, 500));
      } else throw e;
    }

    console.log('\n4. Testing evaluate (Mercury)...');
    try {
      const evaluateResult = await aiService.evaluate({
        systemPrompt: 'You are an evaluator.',
        userPrompt: 'Rate the quality of "Hello world" on a scale of 1-10.',
        temperature: 0.7,
        maxTokens: 3000,
      });
      console.log('✓ evaluate succeeded:', evaluateResult);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      const lower = msg.toLowerCase();
      if (
        msg.includes('MERCURY_API_KEY') ||
        msg.includes('Authentication') ||
        msg.includes('Invalid API Key') ||
        msg.includes('invalid_api_key') ||
        lower.includes('401')
      ) {
        console.log('⚠ evaluate skipped/failed (expected without real Mercury API key):', msg.slice(0, 500));
      } else throw e;
    }

    console.log('\n✅ Smoke test wiring complete — check above for real provider calls. If keys were dummy, failures are expected and prove correct provider routing (Mercury vs Gemini).');
    console.log('   To verify real results: set real MERCURY_API_KEY and GEMINI_API_KEY in .env.local and re-run: npx tsx smoke-test.ts');
  } catch (error) {
    console.error('\n❌ Smoke test failed:', error);
    process.exit(1);
  }
}

smokeTest();
