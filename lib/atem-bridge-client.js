const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

class AtemBridgeClient {
  constructor(options = {}) {
    this.port = options.port || Number(process.env.ATEM_BRIDGE_PORT || 4011);
    this.host = options.host || '127.0.0.1';
    this.log = options.log || (() => {});
    this.helperProcess = null;
    this.helperReady = false;
    this.helperStartingPromise = null;
    this.nextStartAttemptAt = 0;
  }

  get baseUrl() {
    return `http://${this.host}:${this.port}`;
  }

  async ensureHelper() {
    if (await this.isHealthy()) {
      this.helperReady = true;
      return true;
    }

    if (this.helperStartingPromise) {
      return this.helperStartingPromise;
    }

    if (Date.now() < this.nextStartAttemptAt) {
      return false;
    }

    const command = this.resolveHelperCommand();
    if (!command) {
      this.log('ATEM bridge helper not found; continuing without helper');
      return false;
    }

    this.helperStartingPromise = this.startHelper(command);
    try {
      return await this.helperStartingPromise;
    } finally {
      this.helperStartingPromise = null;
    }
  }

  async startHelper(command) {
    this.log('Starting ATEM bridge helper', command.command, command.args.join(' '));

    try {
      this.helperProcess = spawn(command.command, command.args, {
        cwd: process.cwd(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch (error) {
      this.nextStartAttemptAt = Date.now() + 5000;
      this.log(`ATEM bridge helper could not be spawned: ${error.message}`);
      return false;
    }

    this.helperProcess.stdout.on('data', chunk => {
      this.log('[atem-bridge]', chunk.toString().trim());
    });

    this.helperProcess.stderr.on('data', chunk => {
      this.log('[atem-bridge:error]', chunk.toString().trim());
    });

    this.helperProcess.on('error', error => {
      this.helperReady = false;
      this.nextStartAttemptAt = Date.now() + 5000;
      this.log(`ATEM bridge helper process error: ${error.message}`);
    });

    this.helperProcess.on('exit', code => {
      this.helperReady = false;
      this.helperProcess = null;
      this.nextStartAttemptAt = Date.now() + 5000;
      this.log(`ATEM bridge helper exited with code ${code}`);
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 250));
      if (await this.isHealthy()) {
        this.helperReady = true;
        this.nextStartAttemptAt = 0;
        return true;
      }
    }

    this.nextStartAttemptAt = Date.now() + 5000;
    this.log('ATEM bridge helper failed to become healthy');
    return false;
  }

  resolveHelperCommand() {
    if (process.pkg) {
      const exePath = path.join(path.dirname(process.execPath), 'atem-bridge.exe');
      if (fs.existsSync(exePath)) {
        return {
          command: exePath,
          args: []
        };
      }
      return null;
    }

    const workspaceExePath = path.join(process.cwd(), 'bridge', 'bin', 'atem-bridge.exe');
    if (fs.existsSync(workspaceExePath)) {
      return {
        command: workspaceExePath,
        args: []
      };
    }

    const scriptPath = path.join(process.cwd(), 'bridge', 'atem-bridge.js');
    if (!fs.existsSync(scriptPath)) {
      return null;
    }

    return {
      command: process.execPath,
      args: [scriptPath]
    };
  }

  async isHealthy() {
    try {
      const response = await fetch(`${this.baseUrl}/health`);
      return response.ok;
    } catch (error) {
      return false;
    }
  }

  async request(pathname, options = {}) {
    const timeoutMs = pathname === '/v1/connect' ? 15000 : 5000;

    let response;
    try {
      response = await fetch(`${this.baseUrl}${pathname}`, {
        headers: {
          'Content-Type': 'application/json'
        },
        signal: AbortSignal.timeout(timeoutMs),
        ...options
      });
    } catch (error) {
      if (error.name === 'TimeoutError') {
        throw new Error(`Bridge request timed out after ${timeoutMs}ms for ${pathname}`);
      }
      throw error;
    }

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(payload.error || `Bridge request failed: ${response.status}`);
      error.payload = payload;
      throw error;
    }

    return payload;
  }

  async getState() {
    return this.request('/v1/state');
  }

  async connect(ipAddress) {
    return this.request('/v1/connect', {
      method: 'POST',
      body: JSON.stringify({ ipAddress })
    });
  }

  async disconnect() {
    return this.request('/v1/disconnect', { method: 'POST' });
  }

  async setPreviewInput(inputId) {
    return this.request('/v1/preview', {
      method: 'POST',
      body: JSON.stringify({ inputId })
    });
  }

  async setProgramInput(inputId) {
    return this.request('/v1/program', {
      method: 'POST',
      body: JSON.stringify({ inputId })
    });
  }

  async performCut() {
    return this.request('/v1/cut', { method: 'POST' });
  }

  async performAuto() {
    return this.request('/v1/auto', { method: 'POST' });
  }

  async setRecordingFilename(filename) {
    return this.request('/v1/record/filename', {
      method: 'POST',
      body: JSON.stringify({ filename })
    });
  }

  async startRecording() {
    return this.request('/v1/record/start', { method: 'POST' });
  }

  async stopRecording() {
    return this.request('/v1/record/stop', { method: 'POST' });
  }

  async setOutput4Mode(mode) {
    return this.request('/v1/output4/mode', {
      method: 'POST',
      body: JSON.stringify({ mode })
    });
  }
}

module.exports = {
  AtemBridgeClient
};

