import React from 'react';
import {graphql, compose, withApollo} from 'react-apollo';
import {
  Checkbox,
  Container,
  Dropdown,
  Button,
  Grid,
  Icon,
  Input,
  Popup,
  Transition,
} from 'semantic-ui-react';
import RunFeed from '../components/RunFeed';
import RunFiltersRedux from './RunFiltersRedux';
import RunColumnsSelector from '../components/RunColumnsSelector';
import RunTagManager from '../components/RunTagManager';
import ViewModifier from './ViewModifier';
import HelpIcon from '../components/HelpIcon';
import {MODIFY_RUNS, RUN_UPSERT} from '../graphql/runs';
import {MODEL_UPSERT} from '../graphql/models';
import {connect} from 'react-redux';
import queryString from 'query-string';
import _ from 'lodash';
import {
  sortRuns,
  flatKeySuggestions,
  defaultViews,
  parseBuckets,
  setupKeySuggestions,
} from '../util/runhelpers.js';
import {MAX_HISTORIES_LOADED} from '../util/constants.js';
import {bindActionCreators} from 'redux';
import {setColumns, setFilters} from '../actions/run';
import {
  resetViews,
  setServerViews,
  setBrowserViews,
  setActiveView,
  addView,
} from '../actions/view';
import update from 'immutability-helper';
import {BOARD} from '../util/board';
import withRunsDataLoader from '../containers/RunsDataLoader';
import withRunsQueryRedux from '../containers/RunsQueryRedux';
import * as Filter from '../util/filters';
import * as Selection from '../util/selections';

class Runs extends React.Component {
  state = {showFailed: false, activeTab: 0, showFilters: false};

  componentDidUpdate() {
    window.Prism.highlightAll();
  }

  onSort = (column, order = 'descending') => {
    this.props.refetch({order: [column, order].join(' ')});
  };

  _shareableUrl(props) {
    let query = {};
    if (!_.isEmpty(props.runFilters)) {
      query.filters = Filter.toURL(props.runFilters);
    }
    if (!_.isEmpty(props.runSelections)) {
      query.selections = Filter.toURL(props.runSelections);
    }
    if (!_.isNil(props.activeView)) {
      query.activeView = props.activeView;
    }
    return (
      `${window.location.protocol}//${window.location.host}${
        window.location.pathname
      }` +
      '?' +
      queryString.stringify(query)
    );
  }

  _readUrl(props) {
    var parsed = queryString.parse(window.location.search);
    if (!parsed) {
      return;
    }
    let filterFilters;
    if (parsed.filters) {
      filterFilters = Filter.fromURL(parsed.filters);
    } else if (parsed.filter) {
      let filts = parsed.filter;
      if (!_.isArray(filts)) {
        filts = [filts];
      }
      filterFilters = Filter.fromOldURL(filts);
    }
    let selectFilters;
    if (parsed.selections) {
      selectFilters = Filter.fromURL(parsed.selections);
    } else if (parsed.select) {
      let filts = parsed.select;
      if (!_.isArray(filts)) {
        filts = [filts];
      }
      selectFilters = Filter.fromOldURL(filts);
    }

    if (filterFilters) {
      this.props.setFilters('filter', filterFilters);
    } else {
      this.props.setFilters('filter', {
        op: 'OR',
        filters: [
          {
            op: 'AND',
            filters: [
              {key: {section: 'tags', name: 'hidden'}, op: '=', value: false},
            ],
          },
        ],
      });
    }

    if (selectFilters) {
      this.props.setFilters('select', selectFilters);
    } else {
      this.props.setFilters('select', Selection.all());
    }

    if (!_.isNil(parsed.activeView)) {
      this.props.setActiveView('runs', parseInt(parsed.activeView, 10));
    }
  }

  componentWillMount() {
    this.props.resetViews();
    this._readUrl(this.props);
  }

  componentDidMount() {
    this.doneLoading = false;
  }

  componentWillReceiveProps(nextProps) {
    if (
      !this.doneLoading &&
      nextProps.loading === false &&
      nextProps.data.base.length > 0
    ) {
      this.doneLoading = true;
      let defaultColumns = {
        Description: true,
        Ran: true,
        Runtime: true,
        _ConfigAuto: true,
        Sweep: _.indexOf(nextProps.data.columnNames, 'Sweep') !== -1,
      };
      let summaryColumns = nextProps.data.columnNames.filter(col =>
        _.startsWith(col, 'summary')
      );
      for (var col of summaryColumns) {
        defaultColumns[col] = true;
      }
      this.props.setColumns(defaultColumns);
    }
    // Setup views loaded from server.
    if (
      nextProps.data.base.length > 0 &&
      (nextProps.views === null || !nextProps.views.runs) &&
      _.isEmpty(this.props.reduxServerViews.runs.views) &&
      _.isEmpty(this.props.reduxBrowserViews.runs.views)
    ) {
      // no views on server, provide a default
      this.props.setBrowserViews(
        defaultViews((nextProps.buckets.edges[0] || {}).node)
      );
    } else if (
      nextProps.views &&
      nextProps.views.runs &&
      !_.isEqual(nextProps.views, this.props.reduxServerViews)
    ) {
      if (
        _.isEqual(this.props.reduxServerViews, this.props.reduxBrowserViews)
      ) {
        this.props.setBrowserViews(nextProps.views);
      }
      this.props.setServerViews(nextProps.views);
    }
  }

  handleTabChange = (e, {activeIndex}) =>
    this.setState({activeTab: activeIndex});

  render() {
    let tags = [];
    let ModelInfo = this.props.ModelInfo;
    const filterCount = Filter.countIndividual(this.props.runFilters);
    this.props.data.base.forEach(item => {
      tags = [...tags, ...item.tags];
    });
    tags = [...new Set(tags)];
    return (
      <div>
        <Grid>
          <Grid.Row divided columns={2}>
            <Grid.Column>{ModelInfo}</Grid.Column>
            <Grid.Column textAlign="right">
              <p style={{marginBottom: '.5em'}}>
                <Popup
                  content={
                    <Input
                      style={{minWidth: 520}}
                      value={this._shareableUrl(this.props)}
                    />
                  }
                  style={{width: '100%'}}
                  on="click"
                  position="bottom right"
                  wide="very"
                  trigger={
                    <Button
                      style={{marginRight: 6}}
                      icon="linkify"
                      size="mini"
                    />
                  }
                />
                {this.props.data.base.length} total runs,{' '}
                {this.props.data.filtered.length} filtered,{' '}
                {this.props.data.selectedRuns.length} selected
              </p>
              <p>
                <span
                  style={{cursor: 'pointer'}}
                  onClick={() =>
                    this.setState({showFilters: !this.state.showFilters})
                  }>
                  <Icon
                    rotated={this.state.showFilters ? null : 'counterclockwise'}
                    name="dropdown"
                  />
                  {filterCount + ' Filter' + (filterCount === 1 ? '' : 's')}
                </span>
              </p>
            </Grid.Column>
          </Grid.Row>
          <Grid.Row>
            <Grid.Column>
              <Transition.Group
                className="ui grid"
                animation="slide right"
                duration={200}>
                {this.state.showFilters && (
                  <Grid.Row>
                    <Grid.Column width={16}>
                      <h5 style={{marginBottom: 6}}>
                        Filters{' '}
                        <HelpIcon text="Filters limit the set of runs that will be displayed in charts and tables on this page." />
                      </h5>
                      <RunFiltersRedux
                        kind="filter"
                        buttonText="Add Filter"
                        keySuggestions={flatKeySuggestions(
                          this.props.data.keys
                        )}
                        runs={this.props.data.base}
                        filteredRuns={this.props.data.filtered}
                      />
                    </Grid.Column>
                  </Grid.Row>
                )}
              </Transition.Group>
            </Grid.Column>
          </Grid.Row>
          <Grid.Column width={16}>
            {this.props.haveViews && (
              <ViewModifier
                viewType="runs"
                data={this.props.data}
                pageQuery={this.props.query}
                updateViews={views =>
                  this.props.updateModel({
                    entityName: this.props.match.params.entity,
                    name: this.props.match.params.model,
                    id: this.props.projectID,
                    views: views,
                  })
                }
              />
            )}
          </Grid.Column>
          <Grid.Column width={16} style={{zIndex: 2}}>
            <Popup
              trigger={
                <Button
                  disabled={this.props.loading}
                  floated="right"
                  icon="columns"
                  content="Columns"
                />
              }
              content={
                <RunColumnsSelector columnNames={this.props.data.columnNames} />
              }
              on="click"
              position="bottom left"
            />
            {!this.props.haveViews && (
              <Button
                floated="right"
                content="Add Charts"
                disabled={this.props.loading}
                icon="area chart"
                onClick={() => this.props.addView('runs', 'New View', [])}
              />
            )}
            <Dropdown
              icon={null}
              trigger={
                <Button>
                  <Icon
                    name={
                      this.props.data.selectedRuns.length === 0
                        ? 'square outline'
                        : this.props.data.selectedRuns.length ===
                          this.props.data.filtered.length
                          ? 'checkmark box'
                          : 'minus square outline'
                    }
                  />
                  Select
                </Button>
              }
              onClick={(e, {value}) => console.log('dropdown click', value)}>
              <Dropdown.Menu>
                <Dropdown.Item
                  onClick={() =>
                    this.props.setFilters('select', Selection.all())
                  }>
                  <Icon
                    style={{marginRight: 4}}
                    color="grey"
                    name="checkmark box"
                  />{' '}
                  All
                </Dropdown.Item>
                <Dropdown.Item
                  onClick={() =>
                    this.props.setFilters('select', Selection.none())
                  }>
                  <Icon
                    style={{marginRight: 4}}
                    color="grey"
                    name="square outline"
                  />{' '}
                  None
                </Dropdown.Item>
              </Dropdown.Menu>
            </Dropdown>
            <RunTagManager
              selectedRuns={this.props.data.selectedRuns}
              modifyRuns={this.props.modifyRuns}
              tags={tags}
            />
            {/* <p style={{float: 'right'}}>
              Select
              <a>all</a>
              <a>none</a>
            </p> */}
          </Grid.Column>
        </Grid>
        <RunFeed
          admin={this.props.user && this.props.user.admin}
          loading={this.props.loading}
          runs={this.props.data.filtered}
          project={this.props.model}
          onSort={this.onSort}
          showFailed={this.state.showFailed}
          selectable={true}
          selectedRuns={this.props.data.selectedRunsById}
          columnNames={this.props.data.columnNames}
          limit={this.props.limit}
          modifyRuns={this.props.modifyRuns}
        />
      </div>
    );
  }
}

const withMutations = compose(
  graphql(MODEL_UPSERT, {
    props: ({mutate}) => ({
      updateModel: variables =>
        mutate({
          variables: {...variables},
          updateQueries: {
            Model: (prev, {mutationResult}) => {
              const newModel = mutationResult.data.upsertModel.model;
              return update(prev, {model: {$set: newModel}});
            },
          },
        }),
    }),
  }),
  graphql(MODIFY_RUNS, {
    props: ({mutate}) => ({
      modifyRuns: variables => {
        mutate({
          variables: {...variables},
        });
      },
    }),
  }),
  graphql(RUN_UPSERT, {
    props: ({mutate}) => ({
      updateRun: variables => {
        return mutate({
          variables: {...variables},
          updateQueries: {
            Model: (prev, {mutationResult}) => {
              const bucket = mutationResult.data.upsertBucket.bucket;
              return update(prev, {model: {bucket: {$set: bucket}}});
            },
          },
        });
      },
    }),
  })
);

function mapStateToProps(state, ownProps) {
  return {
    jobId: state.runs.currentJob,
    runFilters: state.runs.filters.filter,
    runSelections: state.runs.filters.select,
    user: state.global.user,
    sort: state.runs.sort,
    filterModel: state.runs.filterModel,
    reduxServerViews: state.views.server,
    reduxBrowserViews: state.views.browser,
    activeView: state.views.other.runs.activeView,
    haveViews:
      !_.isEqual(state.views.browser, state.views.server) ||
      state.views.browser.runs.tabs.length > 0,
  };
}

// export dumb component for testing purposes
export {Runs};

const mapDispatchToProps = (dispatch, ownProps) => {
  return bindActionCreators(
    {
      setColumns,
      setFilters,
      setServerViews,
      setBrowserViews,
      setActiveView,
      resetViews,
      addView,
    },
    dispatch
  );
};

export default connect(mapStateToProps, mapDispatchToProps)(
  withMutations(withRunsQueryRedux(withRunsDataLoader(Runs)))
);
