const { test } = require('node:test')
const assert = require('node:assert/strict')
const { serializeRequest, serializeRequestWithImages } = require('../dsh/codex/serialize.js')
const { parseSse } = require('../dsh/codex/sse.js')

for (const [name, serialize] of [
  ['text', options => serializeRequest(options)],
  ['image-capable', options => serializeRequestWithImages(options, {}, {
    readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Buffer.from('fixture') }),
  })],
]) {
  test(`${name}: canonical DSH tool messages retain the function call/result pairing`, async () => {
    const options = { model: 'gpt-6.1-sol', messages: [
      { role: 'assistant', content: [{ type: 'tool-call', id: 'search-call', name: 'web_search', arguments: '{"queries":["probe"]}' }] },
      { role: 'tool', toolCallId: 'search-call', content: [{ type: 'text', text: 'search result' }] },
    ] }
    const before = structuredClone(options)
    const body = await serialize(options)
    assert.deepEqual(body.input.map(item => item.type), ['function_call', 'function_call_output'])
    assert.equal(body.input[1].call_id, body.input[0].call_id)
    assert.equal(body.input[1].output, 'search result')
    assert.deepEqual(options, before)
  })
}

test('canonical tool images follow the text output in an image-bearing user message', async () => {
  const body = await serializeRequestWithImages({ model: 'gpt-6.1-sol', messages: [
    { role: 'tool', toolCallId: 'image-call', content: [{ type: 'text', text: 'screenshot' }, { type: 'image', attachment: { id: 'img', mediaType: 'image/png' } }] },
  ] }, {}, { readImage: async () => ({ ref: { mediaType: 'image/png' }, data: Buffer.from('fixture') }) })
  assert.equal(body.input[0].type, 'function_call_output')
  assert.equal(body.input[0].call_id, 'image-call')
  assert.equal(body.input[1].content[1].type, 'input_image')
})

test('a Responses error event preserves the actual cause instead of reporting a truncated stream', async () => {
  const text = 'data: ' + JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'No tool output found for function call fixture.' } }) + '\n\n'
  const bytes = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode(text)); controller.close() } })
  await assert.rejects(async () => {for await (const event of parseSse(bytes)) void event}, error => error.code === 'INVALID_REQUEST' && /No tool output/.test(error.message))
})
