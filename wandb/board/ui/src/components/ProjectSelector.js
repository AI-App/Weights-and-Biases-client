import React, {Component} from 'react';
import {graphql} from 'react-apollo';
import {Dropdown} from 'semantic-ui-react';
import {MODELS_QUERY} from '../graphql/models';

class ProjectsSelector extends Component {
  static defaultProps = {models: {edges: []}};

  render() {
    let options = this.props.models.edges.map(edge => ({
      text: edge.node.name,
      value: edge.node.name,
    }));
    return (
      <Dropdown
        style={{zIndex: 20}}
        fluid
        selection
        options={options}
        value={this.props.value}
        onChange={(e, {value}) => this.props.onChange(value)}
      />
    );
  }
}

const withData = graphql(MODELS_QUERY, {
  options: ({entity}) => ({
    variables: {entityName: entity},
  }),
  props: ({data: {models, error, variables: {entityName}}}) => ({
    models,
    error,
    entity: entityName,
  }),
});

export default withData(ProjectsSelector);
