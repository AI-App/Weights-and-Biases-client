import logging.config
import os

from flask import Flask

from wandb.board.app import blueprints
from wandb.board.config import config
from wandb.board.app.graphql.loader import load

BLUEPRINTS = [blueprints.graphql]


__all__ = ['create_app']


def create_app(config_name):
    """Create flask app and return it"""
    load()
    app = Flask(__name__, static_folder="../ui/build/static",
                template_folder="../ui/build")

    configure_app(app, config_name)
    configure_blueprints(app, BLUEPRINTS)
    # configure_logging(app)

    return app


def configure_app(app, config_name):
    """Initialize configuration"""
    app.config.from_object(config[config_name])


def configure_blueprints(app, blueprints):
    """Configure blueprints in views"""
    for blueprint in blueprints:
        if isinstance(blueprint, str):
            blueprint = getattr(blueprints, blueprint)
        app.register_blueprint(blueprint)


def configure_logging(app):
    """Configure logging"""
    logging.config.dictConfig(app.config['LOGGING_CONFIG'])
