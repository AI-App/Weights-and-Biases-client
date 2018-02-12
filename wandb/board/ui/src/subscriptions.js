import watch from 'redux-watch';
import {RUNS_QUERY} from './graphql/runs';
import {matchPath} from 'react-router';
import {setFlash} from './actions';

let unsubscribe, runsChannel;
try {
  const p = require('Cloud/util/pusher');
  unsubscribe = p.unsubscribe;
  runsChannel = p.runsChannel;
} catch (e) {
  const p = require('./util/pusher');
  unsubscribe = p.unsubscribe;
  runsChannel = p.runsChannel;
}

const SUBSCRIPTION_COOLDOWN = 5000;

function matchProject(path) {
  return matchPath(path, '/:entity/:project') || {params: {}};
}

function project(path) {
  return matchProject(path).params.project;
}

function updateRunsQuery(store, client, queryVars, payloads) {
  let stats = {};
  stats.start = new Date().getTime();
  let timeStart = 0;

  const state = store.getState();

  //Ensure we do the initial query
  const data = client.readQuery({
      query: RUNS_QUERY,
      variables: queryVars,
    }),
    edges = data.model.buckets.edges;

  for (var payload of payloads) {
    const sameUser = payload.user.username === state.global.user.entity;
    if (payload.state !== 'running' && sameUser) {
      //TODO: fix the finished hack
      //TODO: only dispatch if the run belongs to me
      //TODO: figure out why Lukas has his run marked as failed
      if (payload.state === 'failed') {
        console.log('failed run');
        //store.dispatch(setFlash({message: 'Run Failed', color: 'red'}));
      } else {
        store.dispatch(setFlash({message: 'Run Finished', color: 'green'}));
      }
    }

    let node = Object.assign({}, edges[0].node, payload);
    let idx = edges.findIndex(e => e.node.id === node.id);
    let del = 0;
    if (idx >= 0) del = 1;
    else {
      idx = 0;
      if (sameUser) {
        store.dispatch(setFlash({message: 'New run started', color: 'blue'}));
      }
    }
    edges.splice(idx, del, {node, __typename: edges[0].__typename});
  }

  stats.preWrite = new Date().getTime();
  client.writeQuery({
    query: RUNS_QUERY,
    variables: queryVars,
    data: data,
  });
  stats.writeDone = new Date().getTime();

  // console.log();
  // console.log('STATS');
  // console.log('  submitted payloads', payloads.length);
  // console.log('  next_stuff:', stats.preWrite - stats.start);
  // console.log('  query_write:', stats.writeDone - stats.preWrite);
  // console.log();
}

export default (store, client) => {
  const projectChange = watch(
      store.getState,
      'router.location.pathname',
      (cur, next) => {
        return project(cur) === project(next);
      },
    ),
    slug = params => {
      return `${params.entity}@${params.project}`;
    };
  store.subscribe(
    projectChange((newPath, oldPath) => {
      //TODO: global order state?
      const newParams = matchProject(newPath).params,
        oldParams = matchProject(oldPath).params,
        vars = {
          entityName: newParams.entity,
          name: newParams.project,
          order: 'timeline',
        };
      if (oldParams.project) {
        unsubscribe('runs-' + slug(oldParams));
      }
      if (
        newParams.project &&
        ['teams', 'admin'].indexOf(newParams.entity) < 0 &&
        ['new', 'projects'].indexOf(newParams.project) < 0
      ) {
        let queuedPayloads = [];
        let nextTimeout = null;
        let lastSubmitTime = 0;
        //Ensure we do the initial query
        client
          .query({
            query: RUNS_QUERY,
            variables: vars,
          })
          .then(() => {
            runsChannel(slug(newParams)).bind('updated', payload => {
              // We had a performance problem here where too frequent
              // updates caused the page to hang. Now we queue them up if
              // we're within a cooldown period, and do a single page update
              // for the whole batch.
              queuedPayloads.push(payload);
              let now = new Date().getTime();
              if (now - lastSubmitTime > SUBSCRIPTION_COOLDOWN) {
                updateRunsQuery(store, client, vars, queuedPayloads);
                if (nextTimeout !== null) {
                  clearTimeout(nextTimeout);
                }
                lastSubmitTime = now;
                queuedPayloads = [];
                nextTimeout = null;
              } else {
                if (nextTimeout === null) {
                  nextTimeout = setTimeout(() => {
                    updateRunsQuery(store, client, vars, queuedPayloads);
                    lastSubmitTime = new Date().getTime();
                    queuedPayloads = [];
                    nextTimeout = null;
                  }, SUBSCRIPTION_COOLDOWN);
                }
              }
            });
          });
      }
    }),
  );
};
