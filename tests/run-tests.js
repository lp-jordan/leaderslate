const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { createAtemNote, generateRecordingBaseName, sanitizeCourseName } = require('../lib/atem-utils');
const { SerialTaskQueue } = require('../lib/serial-task-queue');

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    console.error(error.stack);
    process.exitCode = 1;
  }
}

async function main() {
  await run('sanitizeCourseName removes invalid filename characters', async () => {
    assert.equal(sanitizeCourseName('Sunday / Main: Service?'), 'Sunday_Main_Service');
  });

  await run('generateRecordingBaseName uses course plus local timestamp', async () => {
    const date = new Date('2026-03-16T14:05:09');
    assert.equal(generateRecordingBaseName('Launch Weekend', date), 'Launch_Weekend_20260316_140509');
  });

  await run('createAtemNote creates ATEM-tagged note entries', async () => {
    const date = new Date('2026-03-16T10:15:20.120');
    assert.deepEqual(createAtemNote('Recording started', date), {
      timestamp: '10:15:20:03',
      code: 'ATEM',
      note: 'Recording started'
    });
  });

  await run('mock bridge supports direct program input changes', async () => {
    const port = 4315;
    const bridge = spawn(process.execPath, ['bridge/atem-bridge.js'], {
      cwd: process.cwd(),
      env: { ...process.env, ATEM_BRIDGE_PORT: String(port) },
      stdio: ['ignore', 'ignore', 'ignore']
    });

    try {
      let healthy = false;
      for (let attempt = 0; attempt < 20; attempt += 1) {
        try {
          const response = await fetch(`http://127.0.0.1:${port}/health`);
          if (response.ok) {
            healthy = true;
            break;
          }
        } catch (error) {
        }
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      assert.equal(healthy, true);

      let response = await fetch(`http://127.0.0.1:${port}/v1/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ipAddress: '192.168.1.50' })
      });
      assert.equal(response.ok, true);

      response = await fetch(`http://127.0.0.1:${port}/v1/program`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputId: 5 })
      });
      assert.equal(response.ok, true);
      const state = await response.json();
      assert.equal(state.programInput, 5);
    } finally {
      bridge.kill();
      await new Promise(resolve => bridge.once('exit', resolve));
    }
  });

  await run('SerialTaskQueue runs tasks in submission order', async () => {
    const queue = new SerialTaskQueue();
    const events = [];

    await Promise.all([
      queue.enqueue(async () => {
        events.push('first:start');
        await new Promise(resolve => setTimeout(resolve, 20));
        events.push('first:end');
      }),
      queue.enqueue(async () => {
        events.push('second:start');
        events.push('second:end');
      }),
      queue.enqueue(async () => {
        events.push('third:start');
        events.push('third:end');
      })
    ]);

    assert.deepEqual(events, [
      'first:start',
      'first:end',
      'second:start',
      'second:end',
      'third:start',
      'third:end'
    ]);
  });

  await run('SerialTaskQueue continues after a task failure', async () => {
    const queue = new SerialTaskQueue();
    const events = [];

    await assert.rejects(queue.enqueue(async () => {
      events.push('failure:start');
      throw new Error('boom');
    }), /boom/);

    await queue.enqueue(async () => {
      events.push('recovery:start');
      events.push('recovery:end');
    });

    assert.deepEqual(events, [
      'failure:start',
      'recovery:start',
      'recovery:end'
    ]);
  });
}

main().catch(error => {
  console.error(error.stack);
  process.exitCode = 1;
});
