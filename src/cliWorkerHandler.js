const fs = require('fs');
const path = require('path');
const readline = require('readline');
const yargs = require('yargs');
const { terminal } = require('terminal-kit');
const { Worker } = require('worker_threads');
const ExcelJS = require('exceljs');
// const { FileUtils } = require('@adobe/helix-importer');

const noHeadlessWarningHeader = `
! 🚨 NO HEADLESS MODE !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
!                                                                              !
!   Multiple Chromium browser windows will open and be automated by the CLI:   !
!   * DO NOT INTERACT WITH THEM!                                               !
!                                                                              !
!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!

`;

/*
 * Worker handlers
 */

async function workerMsgHandler(worker, urls, results, workerOptions, argv, result) {
  // store the result
  const idx = results.findIndex((r) => r.url === result.url);
  if (idx > -1) {
    const { FileUtils } = await import('@adobe/helix-importer');

    /* eslint-disable-next-line no-param-reassign */
    const u = new URL(result.url);
    result.path = FileUtils.sanitizePath(u.pathname);

    results[idx].status = result;
  }

  // If there are more URLs, send one to the worker
  if (urls.length > 0) {
    const url = urls.shift();
    results.push({ url, status: null });
    worker.postMessage({
      line: urls.length - urls.length,
      options: workerOptions,
      argv,
      url,
    });
  } else {
    // If there are no more URLs, terminate the worker
    worker.postMessage({ type: 'exit' });
  }
}

function workerExitHandler(workers) {
  workers.shift();
}

async function readLines() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const lines = [];

  terminal.brightBlue('Enter a list of URLs (urls pattern: "https://<branch>--<repo>--<owner>.hlx.page/<path>"). Enter an empty line to proceed:\n');

  /* eslint-disable-next-line no-restricted-syntax */
  for await (const input of rl) {
    if (input === '') {
      break;
    }
    lines.push(input);
  }

  rl.close();

  return lines;
}

// reporting feature!
const dataReport = {
  rows: [],
  extraCols: ['hasFaasForm', 'hasNextUpPod', 'hasCardCollection'],
};

const getReport = async () => {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('report');

  const headers = ['URL', 'path'].concat(dataReport.extraCols);

  // create Excel auto Filters for the first row / header
  worksheet.autoFilter = {
    from: 'A1',
    to: `${String.fromCharCode(65 + headers.length - 1)}1`, // 65 = 'A'...
  };

  worksheet.addRows([
    headers,
  ].concat(dataReport.rows.map((row) => {
    const {
      url, path, report,
    } = row;
    const extra = [];
    if (report && dataReport.extraCols) {
      dataReport.extraCols.forEach((col) => {
        const e = report[col];
        if (e) {
          if (typeof e === 'string') {
            if (e.startsWith('=')) {
              extra.push({
                formula: report[col].replace(/=/, '_xlfn.'),
                value: '', // cannot compute a default value
              });
            } else {
              extra.push(report[col]);
            }
          } else {
            extra.push(JSON.stringify(report[col]));
          }
        }
      });
    }
    return [url, path].concat(extra);
  })));

  return workbook.xlsx.writeBuffer();
};

/*
 * Main Handler for CLI commands with worker threads
 */

async function cliWorkerHandler(workerScriptFilename, workerOptions, argv) {
  const { Time } = await import('franklin-bulk-shared');

  // init urls array to store the list of URLs to process
  let urls = [];

  // set worker script
  const workerScript = path.join(__dirname, '../workers/', workerScriptFilename);

  // parse URLs
  if (argv.interactive) {
    urls = await readLines();
  } else if (argv.file) {
    // Read the list of URLs from the file
    urls = fs.readFileSync(argv.file, 'utf-8').split('\n').filter(Boolean);
  } else {
    yargs.showHelp('log');
    terminal.yellow('Please specify either a file or interactive mode\n');
    process.exit(1);
  }

  // Array to keep track of the worker threads
  const workers = [];
  const results = [];

  /*
  * Init workers
  */

  const numWorkers = !workerOptions.headless ? Math.min(argv.workers, 4) : argv.workers;

  if (!workerOptions.headless) {
    terminal.bold.red(noHeadlessWarningHeader);
  }

  terminal.green(`Processing ${urls.length} url(s) with ${numWorkers} worker(s)...\n`);

  // Start the workers
  for (let i = 0; i < numWorkers; i += 1) {
    const worker = new Worker(workerScript);
    workers.push(worker);
    // Handle worker exit
    worker.on('exit', workerExitHandler.bind(null, workers));
    // Listen for messages from the worker thread
    worker.on('message', workerMsgHandler.bind(null, worker, urls, results, workerOptions, argv));

    // Send a URL to each worker
    const url = urls.shift();
    if (url) {
      results.push({ url, status: null });
      workers[i].postMessage({
        idx: i + 1,
        options: workerOptions,
        argv,
        line: urls.length - urls.length,
        url,
      });
    } else {
      // If there are no more URLs, terminate the worker
      workers[i].postMessage({ type: 'exit' });
    }

    // pace worker ramp-up
    /* eslint-disable-next-line no-await-in-loop */
    await Time.sleep(2500);
  }

  return new Promise((resolve) => {
    // Handle ordered output
    const interval = setInterval(async () => {
      while (results.length > 0 && results[0].status !== null) {
        const result = results.shift();
        // console.log(result.status);
        dataReport.rows.push(result.status);
        if (result.status.passed) {
          terminal(` ✅${result.status.warning ? ' 🟠' : ''}  ${result.url}${result.status.warning ? ` ^yWarning: ${result.status.warning}^:` : ''}\n`);
        } else {
          terminal(` ❌  ${result.url} - ^rError: ${result.status.result}^:\n`);
        }
      }

      // console.log(await getReport());

      fs.writeFileSync('./report.xlsx', await getReport());

      if (workers.length === 0) {
        clearInterval(interval);
        resolve();
      }
    }, 5000);
  });
}

/*
 * Exports
 */

exports.cliWorkerHandler = cliWorkerHandler;
