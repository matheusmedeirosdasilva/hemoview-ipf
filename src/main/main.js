const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

let mainWindow;

function appAssetPath(...segments) {
  if (app.isPackaged) {
    const resourcePath = path.join(process.resourcesPath, ...segments);
    if (fs.existsSync(resourcePath)) {
      return resourcePath;
    }

    const unpackedPath = path.join(process.resourcesPath, 'app.asar.unpacked', ...segments);
    if (fs.existsSync(unpackedPath)) {
      return unpackedPath;
    }
  }

  return path.join(app.getAppPath(), ...segments);
}

function packagedBackendPath() {
  const executable = process.platform === 'win32' ? 'analise_ipf.exe' : 'analise_ipf';
  const candidates = [
    appAssetPath('backend', executable),
    appAssetPath('backend', 'analise_ipf', executable)
  ];

  return candidates.find((candidate) => fs.existsSync(candidate)) || null;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1220,
    height: 820,
    minWidth: 980,
    minHeight: 680,
    title: 'IPF VPM Dashboard',
    backgroundColor: '#f6f8fb',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function candidatePythonCommands() {
  const configured = process.env.PYTHON_PATH ? [{ command: process.env.PYTHON_PATH, prefixArgs: [] }] : [];
  const defaults = process.platform === 'win32'
    ? [
        { command: 'py', prefixArgs: ['-3'] },
        { command: 'python', prefixArgs: [] },
        { command: 'python3', prefixArgs: [] }
      ]
    : [
        { command: 'python3', prefixArgs: [] },
        { command: 'python', prefixArgs: [] }
      ];

  return [...configured, ...defaults];
}

function execFilePromise(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      windowsHide: true,
      maxBuffer: 25 * 1024 * 1024,
      ...options
    }, (error, stdout, stderr) => {
      if (error) {
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

async function resolvePython() {
  const errors = [];

  for (const candidate of candidatePythonCommands()) {
    try {
      await execFilePromise(candidate.command, [...candidate.prefixArgs, '--version'], { timeout: 5000 });
      return candidate;
    } catch (error) {
      errors.push(`${candidate.command}: ${error.message}`);
    }
  }

  throw new Error([
    'Python 3 nao foi encontrado.',
    'Instale Python 3 e Pandas/SciPy, ou configure PYTHON_PATH apontando para o python.exe do ambiente virtual.',
    errors.join('\n')
  ].join('\n'));
}

async function analyzeCsv(csvPath) {
  const backendExecutable = packagedBackendPath();
  const columnsConfig = appAssetPath('config', 'columns.json');
  const rulesConfig = appAssetPath('config', 'rules.json');
  const analyzerArgs = [
    csvPath,
    '--columns-config',
    columnsConfig,
    '--rules-config',
    rulesConfig
  ];
  let command;
  let args;

  if (backendExecutable) {
    command = backendExecutable;
    args = analyzerArgs;
  } else {
    const python = await resolvePython();
    const scriptPath = appAssetPath('src', 'backend', 'analise_ipf.py');
    command = python.command;
    args = [
      ...python.prefixArgs,
      scriptPath,
      ...analyzerArgs
    ];
  }

  if (process.env.KEEP_SAMPLE_IDS === '1') {
    args.push('--keep-identifiers');
  }

  const { stdout } = await execFilePromise(command, args, {
    env: {
      ...process.env,
      PYTHONUTF8: '1'
    }
  });

  return JSON.parse(stdout);
}

ipcMain.handle('file:select-and-analyze', async () => {
  const selection = await dialog.showOpenDialog(mainWindow, {
    title: 'Importar planilha do analisador',
    properties: ['openFile'],
    filters: [
      { name: 'Arquivos de dados', extensions: ['csv', 'txt'] },
      { name: 'Todos os arquivos', extensions: ['*'] }
    ]
  });

  if (selection.canceled || selection.filePaths.length === 0) {
    return { canceled: true };
  }

  try {
    const result = await analyzeCsv(selection.filePaths[0]);
    return { canceled: false, result };
  } catch (error) {
    const stderr = error.stderr ? `\n${error.stderr}` : '';
    return {
      canceled: false,
      error: `${error.message}${stderr}`
    };
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
