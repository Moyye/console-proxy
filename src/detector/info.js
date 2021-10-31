const fs = require('fs');
const util = require('util');
const path = require('path');
const agent = require('./base');

const writeFile = util.promisify(fs.writeFile);
const stat = util.promisify(fs.stat);

function round(number, precision = 2) {
  if (typeof number === 'number') {
    return Number.parseFloat(number.toFixed(precision));
  }

  return number;
}

async function getCpuInfo(result) {
  const currentLoad = await agent.currentLoad();
  result.cpu = {
    currentLoad: round(currentLoad.currentLoad),
    currentLoadUser: round(currentLoad.currentLoadUser),
    currentLoadSystem: round(currentLoad.currentLoadSystem),
    currentLoadIdle: round(currentLoad.currentLoadIdle),
    cpuList: currentLoad.cpus.map((cpu) => ({
      // load: round(cpu.load),
      loadUser: round(cpu.loadUser),
      loadSystem: round(cpu.loadSystem),
      loadIdle: round(cpu.loadIdle),
    })),
  };
}

async function getMemoryInfo(result) {
  const mem = await agent.mem();
  result.mem = {
    total: mem.total,
    free: mem.free,
    used: mem.used,
    buffcache: mem.buffcache,
    swaptotal: mem.swaptotal,
    swapused: mem.swapused,
    swapfree: mem.swapfree,
  };
}

async function getFsSize(result) {
  const [fsSize, fsStats] = await Promise.all([
    agent.fsSize(),
    agent.fsStats(),
  ]);

  result.fsSize = fsSize.map((item) => ({
    fs: item.fs,
    type: item.type,
    size: item.size,
    available: item.available,
    mount: item.mount,
  }));

  result.fsStats = {
    rxSec: round((fsStats && fsStats.rx_sec) || 0),
    wxSec: round((fsStats && fsStats.wx_sec) || 0),
  };
}

let rxInit = 0;
let txInit = 0;

async function getNetworkStats(result) {
  const networkStats = await agent.networkStats();
  if (!rxInit) {
    rxInit = networkStats.reduce((a, b) => a + b.rx_bytes, 0);
    txInit = networkStats.reduce((a, b) => a + b.tx_bytes, 0);
  }

  result.networkStats = {
    rxBytes: rxInit
      ? networkStats.reduce((a, b) => a + b.rx_bytes, 0) - rxInit
      : 0,
    txBytes: txInit
      ? networkStats.reduce((a, b) => a + b.tx_bytes, 0) - txInit
      : 0,
    rxSec: round(networkStats.reduce((a, b) => a + b.rx_sec, 0)),
    txSec: round(networkStats.reduce((a, b) => a + b.tx_sec, 0)),
  };
}

async function getProcess(result) {
  const process = await agent.processes();
  result.process = {
    all: process.all,
    running: process.running,
    blocked: process.blocked,
    sleeping: process.sleeping,
  };

  const list = process.list.filter((v) => v.command !== 'linuxInfo.js');

  list.sort((a, b) => b.cpu - a.cpu);
  result.process.cpuSortList = list.slice(0, 5).map((item) => ({
    cpu: round(item.cpu),
    mem: item.memRss,
    // started: item.started,
    command: item.name,
    pid: item.pid,
  }));

  list.sort((a, b) => b.memRss - a.memRss);
  result.process.memRssSortList = list.slice(0, 5).map((item) => ({
    cpu: round(item.cpu),
    mem: item.memRss,
    command: item.command,
    pid: item.pid,
  }));
}

async function getTime(result) {
  const time = await agent.time();

  result.time = {
    timezone: time.timezone,
    uptime: time.uptime,
    timezoneName: time.timezoneName,
  };
}

async function getOs(result) {
  const osInfo = await agent.osInfo();

  result.os = {
    distro: osInfo.distro,
    logofile: osInfo.logofile,
    release: osInfo.release,
    codename: osInfo.codename,
  };
}

async function refresh() {
  const refreshTimeInterval = 4000;
  const statusFilePath = path.join(__dirname, 'status.txt');

  let needRefresh = true;
  try {
    const fileStatus = await stat(statusFilePath);
    if (Date.now() - fileStatus.mtimeMs < refreshTimeInterval) {
      needRefresh = false;
    }
  } catch (e) {
    // ignore
  }

  // 防止多个线程启动
  if (!needRefresh) {
    setTimeout(refresh, refreshTimeInterval);
    return;
  }

  console.time('refresh');
  const result = {};
  await Promise.all([
    getCpuInfo(result),
    getMemoryInfo(result),
    getFsSize(result),
    getNetworkStats(result),
    getProcess(result),
    getTime(result),
    getOs(result),
  ]);

  await writeFile(statusFilePath, JSON.stringify(result));
  console.timeEnd(`refresh`);
  setTimeout(refresh, refreshTimeInterval);
}

refresh().then();
