import { parse, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import forEach from 'lodash.foreach';
import merge from 'lodash.merge';
import get from 'lodash.get';
import { SitespeedioPlugin } from '@sitespeed.io/plugin';

import { analyzeUrl } from './analyzer.js';
import { Aggregator } from './aggregator.js';

import wptpkg from 'webpagetest';
const { defaultServer } = wptpkg;

const __dirname = fileURLToPath(new URL('.', import.meta.url));

// These are the metrics we want to save in
// the time series database per pageSummary
const DEFAULT_PAGE_SUMMARY_METRICS = [
  'data.median.*.SpeedIndex',
  'data.median.*.render',
  'data.median.*.TTFB',
  'data.median.*.loadTime',
  'data.median.*.fullyLoaded',
  'data.median.*.userTimes.*',
  // Use bytesIn to collect data for Opera Mini & UC Mini
  'data.median.*.bytesIn',
  'data.median.*.breakdown.*.requests',
  'data.median.*.breakdown.*.bytes',
  'data.median.*.requestsFull',
  'data.median.*.custom.*',
  'data.median.*.domContentLoadedEventEnd',
  'data.median.*.fullyLoadedCPUms',
  'data.median.*.docCPUms',
  'data.median.*.score_cache',
  'data.median.*.score_gzip',
  'data.median.*.score_combine',
  'data.median.*.score_minify',
  'data.median.*.domElements',
  'data.median.*.lastVisualChange',
  'data.median.*.visualComplete85',
  'data.median.*.visualComplete90',
  'data.median.*.visualComplete95',
  'data.median.*.visualComplete99',
  'data.median.*.FirstInteractive',
  'data.median.*.LastInteractive',
  'data.median.*.TimeToInteractive',
  // hero timings
  'data.median.*.heroElementTimes.*',
  // available only when --timeline option is required for chrome
  'data.median.*.chromeUserTiming.*',
  'data.median.*.cpuTimes.*',
  'data.median.*.TotalBlockingTime',
  'data.median.*.maxFID',
  // Cherry picked metrics for standard deviation
  'data.standardDeviation.*.SpeedIndex',
  'data.standardDeviation.*.render',
  'data.standardDeviation.*.TTFB',
  'data.standardDeviation.*.loadTime',
  'data.standardDeviation.*.fullyLoaded',
  'data.standardDeviation.*.userTimes.*',
  'data.standardDeviation.*.lastVisualChange',
  'data.standardDeviation.*.visualComplete85',
  'data.standardDeviation.*.visualComplete90',
  'data.standardDeviation.*.visualComplete95',
  'data.standardDeviation.*.visualComplete99',
  'data.standardDeviation.*.FirstInteractive',
  'data.standardDeviation.*.LastInteractive',
  'data.standardDeviation.*.TimeToInteractive',
  'data.standardDeviation.*.heroElementTimes.*'
];

// These are the metrics we want to save in
// the time series database per summary (per domain/test/group)
const DEFAULT_SUMMARY_METRICS = [
  'timing.*.SpeedIndex',
  'timing.*.render',
  'timing.*.TTFB',
  'timing.*.fullyLoaded',
  'asset.*.breakdown.*.requests',
  'asset.*.breakdown.*.bytes',
  'custom.*.custom.*'
];

function addCustomMetric(result, filterRegistry) {
  const customMetrics = get(result, 'data.median.firstView.custom');
  if (customMetrics) {
    for (const customMetric of customMetrics) {
      filterRegistry.addFilterForType(
        'data.median.*.' + customMetric,
        'webpagetest.pageSummary'
      );
    }
  }
}

const defaultConfig = {
  host: defaultServer,
  location: 'Dulles:Chrome',
  connectivity: 'Cable',
  runs: 3,
  pollResults: 10,
  timeout: 600,
  includeRepeatView: false,
  private: true,
  aftRenderingTime: true,
  video: true,
  timeline: false
};

function isPublicWptHost(address) {
  const host = /^(https?:\/\/)?([^/]*)/i.exec(address);
  return host && host[2] === parse(defaultServer).host;
}

export default class WebPageTestPlugin extends SitespeedioPlugin {
  constructor(options, context, queue) {
    super({ name: 'webpagetest', options, context, queue });
  }

  open(context, options) {
    // The context holds help methods to setup what we need in plugin
    // Get a log specificfor this plugin
    this.log = context.intel.getLogger('sitespeedio.plugin.webpagetest');
    // Make will help you create messages that you will send on the queue
    this.make = context.messageMaker('webpagetest').make;
    // The aggregator helps you aggregate metrics per URL and/or domain
    this.aggregator = new Aggregator(context.statsHelpers, this.log);
    // The storagemanager helps you save file to disk
    this.storageManager = context.storageManager;
    // The filter registry decides which metrics that will be stored in the time/series db
    this.filterRegistry = context.filterRegistry;

    this.options = merge({}, defaultConfig, options.webpagetest);
    this.allOptions = options;

    if (get(this.options, 'ssio.domainsDashboard')) {
      // that adds a lot of disk space need into graphite, so we keep it hidden for now
      DEFAULT_PAGE_SUMMARY_METRICS.push(
        'data.median.firstView.domains.*.bytes',
        'data.median.firstView.domains.*.requests'
      );
    }

    if (!this.options.key && isPublicWptHost(this.options.host)) {
      throw new Error(
        'webpagetest.key needs to be specified when using the public WebPageTest server.'
      );
    }

    // Register the type of metrics we want to have in the db
    this.filterRegistry.registerFilterForType(
      DEFAULT_PAGE_SUMMARY_METRICS,
      'webpagetest.pageSummary'
    );
    this.filterRegistry.registerFilterForType(
      DEFAULT_SUMMARY_METRICS,
      'webpagetest.summary'
    );
    this.filterRegistry.registerFilterForType(
      DEFAULT_SUMMARY_METRICS,
      'webpagetest.run'
    );

    this.pug = readFileSync(resolve(__dirname, 'pug', 'index.pug'), 'utf8');
  }

  processMessage(message, queue) {
    const filterRegistry = this.filterRegistry;
    const make = this.make;
    const wptOptions = this.options;
    switch (message.type) {
      // In the setup phase, register our pug file(s) in the HTML plugin
      // by sending a message. This plugin uses the same pug for data
      // per run and per page summary.
      case 'sitespeedio.setup': {
        // Tell other plugins that webpagetest will run
        queue.postMessage(make('webpagetest.setup'));
        // Add the HTML pugs
        queue.postMessage(
          make('html.pug', {
            id: 'webpagetest',
            name: 'WebPageTest',
            pug: this.pug,
            type: 'pageSummary'
          })
        );
        queue.postMessage(
          make('html.pug', {
            id: 'webpagetest',
            name: 'WebPageTest',
            pug: this.pug,
            type: 'run'
          })
        );
        break;
      }

      case 'browsertime.navigationScripts': {
        this.log.info(
          'WebPageTest can only be used with URLs and not with scripting/multiple pages at the moment'
        );
        break;
      }

      // We got a URL that we should test
      case 'url': {
        const url = message.url;
        let group = message.group;
        return analyzeUrl(url, this.storageManager, this.log, wptOptions)
          .then(result => {
            addCustomMetric(result, filterRegistry);
            if (result && result.trace) {
              forEach(result.trace, (value, key) => {
                queue.postMessage(
                  make('webpagetest.chrometrace', value, {
                    url,
                    group,
                    name: key + '.json'
                  })
                );
              });
            }

            if (result && result.har) {
              queue.postMessage(
                make('webpagetest.har', result.har, { url, group })
              );

              queue.postMessage(
                make('webpagetest.browser', {
                  browser: result.har.log.browser
                })
              );
            }

            if (result && result.data) {
              forEach(result.data.runs, (run, runKey) =>
                queue.postMessage(
                  make('webpagetest.run', run, {
                    url,
                    group,
                    runIndex: Number.parseInt(runKey) - 1
                  })
                )
              );
            }
            if (result && result.data) {
              const location = result.data.location
                .replace(':', '-')
                .replace(' ', '-')
                .toLowerCase();
              // There's no connectivity setup in the default config for WPT, make sure we catch that
              const connectivity = get(
                result,
                'data.connectivity',
                'native'
              ).toLowerCase();
              queue.postMessage(
                make('webpagetest.pageSummary', result, {
                  url,
                  group,
                  location,
                  connectivity
                })
              );
              this.aggregator.addToAggregate(
                group,
                result,
                connectivity,
                location,
                wptOptions
              );
            }
          })
          .catch(error => {
            this.log.error('Error creating WebPageTest result ', error);
            queue.postMessage(
              make('error', error, {
                url
              })
            );
          });
      }

      // All URLs are tested, now create summaries per page and domain/group
      case 'sitespeedio.summarize': {
        let summary = this.aggregator.summarize();
        if (summary && Object.keys(summary.groups).length > 0) {
          for (let group of Object.keys(summary.groups)) {
            queue.postMessage(
              make('webpagetest.summary', summary.groups[group], {
                connectivity: this.aggregator.connectivity,
                location: this.aggregator.location,
                group
              })
            );
          }
        }
      }
    }
  }
}
