import {
  updateRuns,
  flatKeySuggestions,
  setupKeySuggestions,
  sortRuns,
  getColumns,
} from '../../util/runhelpers.js';
import {JSONparseNaN} from '../../util/jsonnan';
import * as Run from '../../util/runs';
import * as Filter from '../../util/filters';
import * as Query from '../../util/query';
import _ from 'lodash';

let runs = [];

function handleMessage(m, postMessage) {
  let {base, prevBuckets, buckets, query} = m.data;
  if (Query.canReuseBaseData(query)) {
    runs = base;
  } else {
    runs = updateRuns(prevBuckets, buckets, runs);
  }
  let filteredRuns = sortRuns(
    query.sort,
    Filter.filterRuns(query.filters, runs)
  );
  let keySuggestions = setupKeySuggestions(runs);
  let filteredRunsById = {};
  for (var run of filteredRuns) {
    filteredRunsById[run.name] = run;
  }
  let selectedRuns = [];
  if (_.size(query.selections) !== 0) {
    selectedRuns = Filter.filterRuns(query.selections, filteredRuns);
  }
  let selectedRunsById = _.fromPairs(
    selectedRuns.map(run => [run.name, run.id])
  );
  if (query.sort.name === 'selected') {
    // add `selected` param for sorting
    filteredRuns.map(run => {
      run.selected = _.includes(selectedRunsById, run.id);
      return run;
    });
    // resort by `selected`
    filteredRuns = sortRuns(query.sort, filteredRuns);
  }
  let keys = _.flatMap(keySuggestions, section => section.suggestions);
  let axisOptions = keys.map(key => {
    let displayKey = Run.displayKey(key);
    return {
      key: displayKey,
      value: displayKey,
      text: displayKey,
    };
  });

  let columnNames = getColumns(runs);
  let data = {
    base: runs,
    filtered: filteredRuns,
    filteredRunsById,
    selectedRuns,
    selectedRunsById,
    keys: keySuggestions,
    axisOptions,
    columnNames,
  };
  postMessage(data);
}

self.addEventListener('message', m => {
  handleMessage(m, self.postMessage);
});

// This is used only in tests.
export default class FakeWorker {
  constructor(stringUrl) {
    this.url = stringUrl;
    this.onmessage = () => {};
  }

  postMessage(m) {
    // Commented out because it causes the test to crash
    //handleMessage(m, this.onmessage);
  }
}
