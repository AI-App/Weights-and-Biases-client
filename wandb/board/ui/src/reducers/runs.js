import update from 'immutability-helper';
import _ from 'lodash';
import {
  TOGGLE_RUN_SELECTION,
  UPDATE_RUN_SELECTIONS,
  UPDATE_JOB,
  SET_FILTERS,
  SET_COLUMNS,
  TOGGLE_COLUMN,
  ENABLE_COLUMN,
  DISABLE_COLUMN,
  SET_SORT,
  CURRENT_PAGE,
  SET_HIGHLIGHT,
} from '../actions/run.js';
import * as Query from '../util/query';

let nextFilterID = 0;

export default function runs(
  state = {
    selected: {},
    filters: {filter: {}, select: {}},
    highlight: null,
    editingFilter: null,
    columns: {},
    plots: [],
    sort: {},
    pages: {},
  },
  action,
) {
  switch (action.type) {
    case TOGGLE_RUN_SELECTION:
      let selected = {...state.selected};
      if (state.selected[action.name]) {
        delete selected[action.name];
      } else {
        selected[action.name] = action.id;
      }
      return {...state, selected: selected};
    case UPDATE_RUN_SELECTIONS:
      selected = [];
      action.selects.forEach((run, i) => {
        selected[run] = true;
      });
      return {...state, selected: selected};
    case UPDATE_JOB:
      return {...state, currentJob: action.id};
    case SET_FILTERS:
      let result = update(state, {
        filters: {[action.kind]: {$set: action.filters}},
      });
      return result;
    case SET_HIGHLIGHT:
      return update(state, {highlight: {$set: action.runId}});
    case SET_COLUMNS:
      return {
        ...state,
        columns: action.columns,
      };
    case TOGGLE_COLUMN:
      return {
        ...state,
        columns: {
          ...state.columns,
          [action.name]: !state.columns[action.name],
        },
      };
    case ENABLE_COLUMN:
      return {
        ...state,
        columns: {...state.columns, [action.name]: true},
      };
    case DISABLE_COLUMN:
      return {
        ...state,
        columns: {...state.columns, [action.name]: false},
      };
    case SET_SORT:
      return {
        ...state,
        sort: action,
      };
    case CURRENT_PAGE:
      return {
        ...state,
        pages: {
          ...state.pages,
          [action.id]: {
            current: action.page > 0 ? action.page : 1,
          },
        },
      };
    default:
      return state;
  }
}
