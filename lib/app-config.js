const fs = require('fs');
const path = require('path');

const CONFIG_PATH = process.env.LEADERSLATE_CONFIG_PATH || path.join(process.cwd(), 'leaderslate.config.json');

function defaultConfig() {
  return {
    atem: {
      switcherIp: '',
      bridgePort: Number(process.env.ATEM_BRIDGE_PORT || 4011)
    }
  };
}

function ensureConfigDir() {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function loadConfig() {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_PATH)) {
    return defaultConfig();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    return {
      ...defaultConfig(),
      ...parsed,
      atem: {
        ...defaultConfig().atem,
        ...(parsed.atem || {})
      }
    };
  } catch (error) {
    return defaultConfig();
  }
}

function saveConfig(config) {
  ensureConfigDir();
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

module.exports = {
  CONFIG_PATH,
  loadConfig,
  saveConfig
};
