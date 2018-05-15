import React, {PureComponent} from 'react';
import {
  Button,
  Checkbox,
  Icon,
  Image,
  Label,
  Loader,
  Table,
  Item,
  Popup,
} from 'semantic-ui-react';
import TimeAgo from 'react-timeago';
import {NavLink} from 'react-router-dom';
import './RunFeed.css';
import Launcher from '../containers/Launcher';
import FixedLengthString from '../components/FixedLengthString';
import Tags from '../components/Tags';
import RunFeedRunRow from './RunFeedRunRow';
import {connect} from 'react-redux';
import {bindActionCreators} from 'redux';
import {makeShouldUpdate} from '../util/shouldUpdate';
import {setFilters, enableColumn, setSort} from '../actions/run';
import _ from 'lodash';
// import {JSONparseNaN} from '../util/jsonnan';
import Pagination from './Pagination';
import {
  displayValue,
  getRunValue,
  sortableValue,
  stateToIcon,
  truncateString,
  autoCols,
} from '../util/runhelpers.js';
import withRunsDataLoader from '../containers/RunsDataLoader';
import ContentLoader from 'react-content-loader';
import * as Selection from '../util/selections';
import * as Run from '../util/runs';
import * as Filter from '../util/filters';

const maxColNameLength = 20;

class RunFeedHeader extends React.Component {
  constructor(props) {
    super(props);
    // This seems like it would be expensive but it's not (.5ms on a row with ~100 columns)
    this._shouldUpdate = makeShouldUpdate({
      name: 'RunFeedHeader',
      deep: ['columnNames'],
      ignoreFunctions: true,
      debug: false,
    });
  }

  shouldComponentUpdate(nextProps, nextState) {
    return this._shouldUpdate(this.props, nextProps);
  }

  render() {
    let {sort, columnNames} = this.props;
    let longestColumn =
      Object.assign([], columnNames).sort((a, b) => b.length - a.length)[0] ||
      '';
    return (
      <Table.Header>
        <Table.Row
          style={{
            height: Math.min(longestColumn.length, maxColNameLength) * 8,
            borderLeft: '1px solid rgba(34,36,38,.15)',
          }}>
          {columnNames.map(columnName => {
            let columnKey = columnName.split(':')[1];
            if (columnName === 'Select') {
              return <Table.HeaderCell key="select" />;
            }
            return (
              <Table.HeaderCell
                key={columnName}
                className={
                  _.startsWith(columnName, 'config:') ||
                  _.startsWith(columnName, 'summary:')
                    ? 'rotate'
                    : ''
                }
                style={{textAlign: 'center', verticalAlign: 'bottom'}}
                onClick={() => {
                  if (columnName === 'Runtime') {
                    return;
                  }
                  if (columnName === 'Ran') {
                    this.props.setSort(null, true);
                  } else {
                    let ascending = true;
                    if (sort.name === columnName) {
                      ascending = !sort.ascending;
                    }
                    this.props.setSort(columnName, ascending);
                  }
                }}>
                <div>
                  {_.startsWith(columnName, 'config:') ||
                  _.startsWith(columnName, 'summary:') ? (
                    columnKey.length > maxColNameLength ? (
                      <span key={columnName}>
                        {truncateString(columnKey, maxColNameLength)}
                      </span>
                    ) : (
                      <span>{columnKey}</span>
                    )
                  ) : (
                    <span>{columnName}</span>
                  )}

                  {sort.name === columnName &&
                    (sort.ascending ? (
                      <Icon name="caret up" />
                    ) : (
                      <Icon name="caret down" />
                    ))}
                </div>
              </Table.HeaderCell>
            );
          })}
        </Table.Row>
      </Table.Header>
    );
  }
}

class RunFeedSubgroupRuns extends React.Component {
  _setup(props) {
    if (props.setSubgroupLength) {
      if (!props.loading && props.data && props.data.filtered) {
        props.setSubgroupLength(props.data.filtered.length);
      } else {
        props.setSubgroupLength(1);
      }
    }
  }

  componentWillMount() {
    this._setup(this.props);
  }

  componentWillReceiveProps(nextProps) {
    this._setup(nextProps);
  }

  render() {
    if (this.props.loading) {
      return (
        <RunFeedRunRow
          {...this.props}
          descriptionHeight={
            this.props.subgroupCount ? this.props.descriptionHeight : 1
          }
          loading={this.props.subgroupCount ? false : true}
          subgroupLoading={true}
        />
      );
    }
    const runs = this.props.data.filtered;
    return runs.map((run, index) => {
      return (
        <RunFeedRunRow
          key={run.id}
          {...this.props}
          descriptionHeight={index === 0 && this.props.descriptionHeight}
          subgroupHeight={index === 0 && runs.length}
          run={run}
          allowSelection
        />
      );
    });
  }
}

RunFeedSubgroupRuns = withRunsDataLoader(RunFeedSubgroupRuns);

class RunFeedSubgroupRow extends React.Component {
  render() {
    const {run, subgroupName, firstCell, groupHeight, runsClick} = this.props;
    if (!this.props.open) {
      return <RunFeedRunRow {...this.props} />;
    } else {
      let query = _.cloneDeep(this.props.query);
      const groupKey = Run.keyFromString(this.props.query.grouping.group);
      const subgroupKey = Run.keyFromString(this.props.query.grouping.subgroup);
      query.filters = {
        op: 'AND',
        filters: [
          query.filters,
          {
            key: groupKey,
            op: '=',
            value: Run.getValue(run, groupKey),
          },
          {
            key: subgroupKey,
            op: '=',
            value: Run.getValue(run, subgroupKey),
          },
        ],
      };
      query.level = 'run';
      // Big page size so we load all runs
      query.page = {
        size: 1000,
      };
      return (
        <RunFeedSubgroupRuns
          {...this.props}
          query={query}
          setSubgroupLength={this.props.setSubgroupLength}
        />
      );
    }
  }
}

class RunFeedSubgroups extends React.Component {
  state = {openSubgroups: {}, subgroupLengths: {}, openAllSubgroups: false};

  openSubgroups() {
    let openSubgroups = this.state.openSubgroups;
    const subgroupKey = Run.keyFromString(this.props.query.grouping.subgroup);
    const runs = this.props.data.filtered;
    if (this.state.openAllSubgroups) {
      openSubgroups = _.fromPairs(
        runs.map(r => [Run.getValue(r, subgroupKey), true])
      );
    }
    return openSubgroups;
  }

  render() {
    if (this.props.loading) {
      return (
        <RunFeedRunRow
          {...this.props}
          descriptionHeight={1}
          showSubgroup={false}
        />
      );
    }
    if (!this.props.subgroupOpen) {
      return (
        <RunFeedRunRow
          {...this.props}
          descriptionHeight={1}
          subgroupHeight={1}
          showSubgroup={false}
          runsOpen={false}
          runsClick={() => {
            this.props.subgroupClick();
            this.setState({openAllSubgroups: true});
          }}
        />
      );
    }
    const subgroupKey = Run.keyFromString(this.props.query.grouping.subgroup);
    const runs = this.props.data.filtered;
    const openSubgroups = this.openSubgroups();
    const allOpen =
      _.filter(openSubgroups, open => open).length === runs.length;
    const descriptionHeight = _.sum(
      runs.map(
        run =>
          openSubgroups[Run.getValue(run, subgroupKey)] &&
          this.state.subgroupLengths[Run.getValue(run, subgroupKey)]
            ? this.state.subgroupLengths[Run.getValue(run, subgroupKey)]
            : 1
      )
    );
    return _.sortBy(runs, r => Run.getValue(r, subgroupKey)).map(
      (run, index) => {
        const subgroup = Run.getValue(run, subgroupKey);
        const subgroupOpen = !!openSubgroups[subgroup];
        return (
          <RunFeedSubgroupRow
            {...this.props}
            key={run.id}
            run={run}
            subgroupName={subgroup}
            descriptionHeight={index === 0 && descriptionHeight}
            runsOpen={allOpen}
            runsClick={() =>
              !allOpen
                ? this.setState({openAllSubgroups: true})
                : this.setState({openSubgroups: {}, openAllSubgroups: false})
            }
            subgroupRunCount={run.groupCounts[1]}
            subgroupRunsClick={() => {
              this.setState({
                openSubgroups: {
                  ...this.openSubgroups(),
                  [subgroup]: !subgroupOpen,
                },
                openAllSubgroups: false,
              });
            }}
            subgroupRunsOpen={subgroupOpen}
            open={this.state.openAllSubgroups || openSubgroups[subgroup]}
            setSubgroupLength={len => {
              // Use alternative setState convention where we pass a function that modifies the previos
              // state, because setSubgroupLenght may be called twice in the same event loop pass.
              this.setState(previousState => {
                return {
                  ...previousState,
                  subgroupLengths: {
                    ...previousState.subgroupLengths,
                    [subgroup]: len,
                  },
                };
              });
            }}
          />
        );
      }
    );
  }
}

RunFeedSubgroups = withRunsDataLoader(RunFeedSubgroups);

class RunFeedGroupSubgroupRow extends React.Component {
  state = {};

  render() {
    let {run, loading, columnNames, project} = this.props;
    let query = _.cloneDeep(this.props.query);
    const groupKey = Run.keyFromString(this.props.query.grouping.group);
    query.filters = {
      op: 'AND',
      filters: [
        query.filters,
        {
          key: groupKey,
          op: '=',
          value: Run.getValue(run, groupKey),
        },
      ],
    };
    query.level = 'subgroup';
    query.disabled = !this.state.subgroupOpen;
    // Set a big page size so that we load all subgroups
    query.page = {
      size: 500,
    };
    return (
      <RunFeedSubgroups
        {...this.props}
        showSubgroup={true}
        subgroupHeight={1}
        subgroupClick={() =>
          this.setState({subgroupOpen: !this.state.subgroupOpen})
        }
        subgroupOpen={this.state.subgroupOpen}
        query={query}
      />
    );
  }
}

class RunFeedGroupRow extends React.Component {
  state = {};

  render() {
    if (!this.state.runsOpen) {
      return (
        <RunFeedRunRow
          {...this.props}
          descriptionHeight={1}
          showSubgroup={false}
          runsOpen={false}
          runsClick={() => {
            this.setState({runsOpen: !this.state.runsOpen});
          }}
        />
      );
    }
    let {run, loading, columnNames, project} = this.props;
    let query = _.cloneDeep(this.props.query);
    const groupKey = Run.keyFromString(this.props.query.grouping.group);
    query.filters = {
      op: 'AND',
      filters: [
        query.filters,
        {
          key: groupKey,
          op: '=',
          value: Run.getValue(run, groupKey),
        },
      ],
    };
    query.level = 'run';
    query.disabled = !this.state.runsOpen;
    // Set a big page size so that we load all subgroups
    query.page = {
      size: 1000,
    };
    return (
      <RunFeedSubgroupRuns
        {...this.props}
        descriptionHeight={this.props.runCount}
        runsClick={() => this.setState({runsOpen: !this.state.runsOpen})}
        runsOpen={this.state.runsOpen}
        query={query}
      />
    );
  }
}

class RunFeed extends PureComponent {
  state = {pageLoading: true};

  static defaultProps = {
    currentPage: 1,
  };
  state = {sort: 'timeline', dir: 'descending'};

  handleScroll() {
    if (this.props.loading || this.state.pageLoading) {
      return;
    }
    const windowHeight =
      'innerHeight' in window
        ? window.innerHeight
        : document.documentElement.offsetHeight;
    const body = document.body;
    const html = document.documentElement;
    const docHeight = Math.max(
      body.scrollHeight,
      body.offsetHeight,
      html.clientHeight,
      html.scrollHeight,
      html.offsetHeight
    );
    const windowBottom = windowHeight + window.pageYOffset;
    if (windowBottom >= docHeight) {
      if (this.props.data.loadMore) {
        this.setState({pageLoading: true});
        this.props.data.loadMore(() => {
          this.setState({pageLoading: false});
        });
      }
    }
  }

  componentDidMount() {
    // window.addEventListener('scroll', () => this.handleScroll());
  }

  componentWillMount() {
    this._setup(this.props);
  }

  componentWillUnmount() {
    // window.removeEventListener('scroll', () => this.handleScroll());
  }

  componentDidUpdate() {
    // setTimeout(() => this.handleScroll(), 1);
  }

  _setup(props) {
    const conf = props.config;
    if (props.data.length === 0 && props.loading) {
      this.columnNames = ['Description'];
    } else {
      this.columnNames = ['Select', 'Description'];
      if (this.props.query.grouping && this.props.query.grouping.subgroup) {
        this.columnNames.push('Subgroup');
      }
      let configColumns;
      if (!conf.config || (conf.config.auto == null || conf.config.auto)) {
        configColumns = autoCols('config', props.data.filtered, 1);
      } else {
        configColumns = conf.config.columns || [];
      }
      let summaryColumns;
      if (!conf.summary || (conf.summary.auto == null || conf.summary.auto)) {
        summaryColumns = autoCols('summary', props.data.filtered, 0);
      } else {
        summaryColumns = conf.summary.columns || [];
      }
      this.columnNames = this.columnNames.concat(
        ['Ran', 'Runtime'],
        configColumns,
        summaryColumns
      );
    }
  }

  componentWillReceiveProps(nextProps) {
    if (
      this.props.data.filtered !== nextProps.data.filtered ||
      this.props.loading !== nextProps.loading
    ) {
      this._setup(nextProps);
    }
  }

  sortedClass(type) {
    return this.state.sort === type ? `sorted ${this.state.dir}` : '';
  }

  onSort(name) {
    let dir = this.state.dir;
    if (this.state.sort === name) {
      dir = this.state.dir === 'descending' ? 'ascending' : 'descending';
      this.setState({dir: dir});
    } else {
      this.setState({sort: name});
    }
    this.props.onSort(name, dir);
  }

  render() {
    const runsLength = this.props.runCount;
    let runs = this.props.data.filtered;
    if (!this.props.loading && runsLength === 0) {
      return (
        <div style={{marginTop: 30}}>No runs match the chosen filters.</div>
      );
    }
    return (
      <div>
        <div className="runsTable">
          <Table
            definition
            style={{borderLeft: null}}
            celled
            sortable
            compact
            unstackable
            size="small">
            <RunFeedHeader
              sort={this.props.sort}
              setSort={this.props.setSort}
              columnNames={this.columnNames}
            />
            <Table.Body>
              {(this.state.pageLoading || !this.props.loading) &&
                runs &&
                runs.map((run, i) => {
                  if (
                    this.props.query.level &&
                    this.props.query.grouping &&
                    this.props.query.grouping.group &&
                    this.props.query.grouping.subgroup &&
                    this.props.query.level === 'group'
                  ) {
                    return (
                      <RunFeedGroupSubgroupRow
                        key={i}
                        groupKey={this.props.query.grouping.group}
                        subgroupKey={this.props.query.grouping.subgroup}
                        run={run}
                        descriptionRun={run}
                        subgroupCount={run.groupCounts[0]}
                        runCount={run.groupCounts[1]}
                        loading={false}
                        selections={this.props.selections}
                        columnNames={this.columnNames}
                        project={this.props.project}
                        addFilter={(type, key, op, value) =>
                          this.props.setFilters(
                            type,
                            Filter.Update.groupPush(this.props.filters, [0], {
                              key,
                              op,
                              value,
                            })
                          )
                        }
                        query={this.props.query}
                        setFilters={this.props.setFilters}
                      />
                    );
                  } else if (
                    this.props.query.level &&
                    this.props.query.grouping &&
                    this.props.query.grouping.group &&
                    this.props.query.level === 'group'
                  ) {
                    return (
                      <RunFeedGroupRow
                        key={i}
                        groupKey={this.props.query.grouping.group}
                        subgroupKey={this.props.query.grouping.subgroup}
                        run={run}
                        descriptionRun={run}
                        runCount={run.groupCounts[0]}
                        loading={false}
                        selections={this.props.selections}
                        columnNames={this.columnNames}
                        project={this.props.project}
                        addFilter={(type, key, op, value) =>
                          this.props.setFilters(
                            type,
                            Filter.Update.groupPush(this.props.filters, [0], {
                              key,
                              op,
                              value,
                            })
                          )
                        }
                        query={this.props.query}
                        setFilters={this.props.setFilters}
                      />
                    );
                  } else {
                    return (
                      <RunFeedRunRow
                        key={i}
                        run={run}
                        loading={false}
                        selections={this.props.selections}
                        columnNames={this.columnNames}
                        project={this.props.project}
                        descriptionHeight={1}
                        addFilter={(type, key, op, value) =>
                          this.props.setFilters(
                            type,
                            Filter.Update.groupPush(this.props.filters, [0], {
                              key,
                              op,
                              value,
                            })
                          )
                        }
                        setFilters={this.props.setFilters}
                        allowSelection
                      />
                    );
                  }
                })}
              {this.props.loading && (
                <RunFeedRunRow
                  descriptionHeight={1}
                  loading={true}
                  run={{summary: {}, config: {}}}
                  columnNames={this.columnNames}
                />
              )}
            </Table.Body>
          </Table>
        </div>
        <Button content="Load More" onClick={() => this.handleScroll()} />
      </div>
    );
  }
}

function mapStateToProps() {
  let prevColumns = null;
  let prevRuns = null;
  let cols = {};
  let autoCols = {};

  return function(state, ownProps) {
    const id = ownProps.project.id;
    return {
      columns: cols,
      sort: state.runs.sort,
      currentPage: state.runs.pages[id] && state.runs.pages[id].current,
      selections: state.runs.filters.select,
      filters: state.runs.filters.filter,
    };
  };
}

const mapDispatchToProps = (dispatch, ownProps) => {
  return bindActionCreators({setFilters, setSort}, dispatch);
};

// export dumb component for testing purposes
export {RunFeed};

export default withRunsDataLoader(
  connect(mapStateToProps(), mapDispatchToProps)(RunFeed)
);
