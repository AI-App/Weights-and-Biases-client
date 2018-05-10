import React, {Component} from 'react';
import {
  Button,
  Label,
  Grid,
  Header,
  Modal,
  Message,
  Segment,
} from 'semantic-ui-react';
import {NavLink} from 'react-router-dom';
import Markdown from './Markdown';
import Tags from './Tags';
import TimeAgo from 'react-timeago';

/**
 *  This component makes the summary on top of a runs page.
 */

class RunSummary extends Component {
  color() {
    switch (this.props.bucket.state) {
      case 'running':
        return 'blue';
      case 'finished':
        return 'green';
      case 'killed':
        return 'orange';
      case 'crashed':
      case 'failed':
        return 'red';
      default:
        return 'blue';
    }
  }

  componentDidUpdate() {
    window.Prism.highlightAll();
  }

  render() {
    const {model, bucket} = this.props;
    const parts = (bucket.description || 'No run message').trim().split('\n'),
      header = parts.shift(),
      body = parts.join('\n');
    return (
      <div>
        <Message
          attached
          header={
            <div>
              <Header style={{display: 'inline'}}>
                {header.substring(0, 70)}
              </Header>
              <Button.Group
                style={{position: 'relative', top: -3}}
                size="tiny"
                floated="right">
                <NavLink
                  to={`/${model.entityName}/${model.name}/runs/${
                    bucket.name
                  }/edit`}>
                  <Button icon="edit" basic />
                </NavLink>
                {bucket.sweep &&
                  bucket.state === 'running' && (
                    <Button
                      icon="stop circle"
                      onClick={() => {
                        if (window.confirm('Should we stop this run?')) {
                          this.props.onStop(bucket.id);
                        }
                      }}
                      negative
                    />
                  )}
              </Button.Group>
            </div>
          }
          content={body.length > 0 && <Markdown content={body} />}
          color={this.color()}
        />
        <Segment attached="bottom" className="overview">
          <Grid>
            <Grid.Row>
              <Grid.Column width={8}>
                {this.props.bucket.state == 'running' ? (
                  <strong>running </strong>
                ) : (
                  <strong>ran </strong>
                )}
                {bucket.user && this.props.bucket.state == 'running' ? (
                  <span>for </span>
                ) : (
                  <span>by </span>
                )}
                {bucket.user && <strong>{bucket.user.username}</strong>}{' '}
                {bucket.heartbeatAt && (
                  <span>
                    for{' '}
                    <strong>
                      <TimeAgo
                        date={bucket.createdAt + 'Z'}
                        now={() => {
                          return Date.parse(bucket.heartbeatAt + 'Z');
                        }}
                        formatter={(v, u, s, d, f) => f().replace(s, '')}
                        live={false}
                      />
                    </strong>
                  </span>
                )}
                {bucket.host && (
                  <span>
                    on <strong>{bucket.host}</strong>
                  </span>
                )}
              </Grid.Column>
              <Grid.Column width={8} textAlign="right">
                {bucket.tags && (
                  <span>
                    {bucket.tags.length > 0 && 'tags '}
                    <Tags
                      id={bucket.id}
                      options={[]}
                      tags={bucket.tags}
                      modifyRuns={this.props.modifyRuns}
                    />{' '}
                  </span>
                )}
                run{' '}
                <NavLink
                  to={`/${model.entityName}/${model.name}/runs/${bucket.name}`}>
                  {bucket.name}
                </NavLink>
                {bucket.commit && ' commit '}
                {bucket.commit && (
                  <Modal
                    on="click"
                    trigger={
                      <a onClick={e => e.preventDefault()} href={bucket.github}>
                        {bucket.commit.slice(0, 6)}
                      </a>
                    }>
                    <Modal.Header>
                      <h1>Git commit</h1>
                    </Modal.Header>
                    <Modal.Content>
                      <p>
                        Wandb saves the commit ID of the last commit before
                        every run.
                      </p>

                      <p>
                        If you pushed the commit to github, you can find your
                        commit at <a href={bucket.github}>this github link</a>.
                      </p>

                      <p>
                        If you made changes before running and did not commit
                        them, wandb saves the changes in a patch (.diff) file.
                      </p>
                    </Modal.Content>
                  </Modal>
                )}
              </Grid.Column>
            </Grid.Row>
          </Grid>
        </Segment>
      </div>
    );
  }
}

export default RunSummary;
