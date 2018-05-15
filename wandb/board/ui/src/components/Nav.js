import React, {Component} from 'react';
import {connect} from 'react-redux';
import {NavLink, withRouter} from 'react-router-dom';
import {Menu, Container, Message, Transition} from 'semantic-ui-react';
import logo from '../assets/wandb.svg';

import '../components/Nav.css';

class Nav extends Component {
  state = {showFlash: false};

  componentDidMount() {
    if (this.props.flash) {
      this.setState({showFlash: true});
    }
  }

  componentWillReceiveProps(nextProps) {
    if (nextProps.flash && nextProps.flash !== this.props.flash) {
      this.setState({showFlash: true});
    }
  }

  render() {
    const flash = this.props.flash || {};
    return (
      <Menu fixed="top" borderless>
        <Container fluid style={{marginLeft: 10, position: 'relative'}}>
          <NavLink exact to="/" className="item logo">
            <img src={logo} alt="W&B" />
          </NavLink>
          <NavLink
            to={`/`}
            isActive={() =>
              //TODO: very unfortunate
              this.props.location.pathname.indexOf('dashboards') === -1
            }
            className="item">
            Runs
          </NavLink>
          <NavLink to={`/dashboards/edit`} className="item">
            Dashboards
          </NavLink>
          <Menu.Menu position="right" />
          <Transition
            animation="fly down"
            duration={1000}
            visible={this.state.showFlash}
            onComplete={() => {
              if (!flash.sticky)
                setTimeout(() => this.setState({showFlash: false}), 5000);
            }}>
            <Message
              floating
              color={flash.color || 'orange'}
              onDismiss={() => this.setState({showFlash: false})}
              compact
              style={{
                position: 'absolute',
                right: 10,
                top: 50,
                paddingRight: 30,
              }}>
              {flash.message}
            </Message>
          </Transition>
        </Container>
      </Menu>
    );
  }
}

function mapStateToProps(state, ownProps) {
  return {
    flash: state.global.flash,
    params: state.location.params || {},
  };
}

export default withRouter(connect(mapStateToProps)(Nav));
