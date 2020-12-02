import wandb
import numpy as np
import time
import shutil

def teardown():
    shutil.rmtree("wandb")
    shutil.rmtree("artifacts")

def test_artifact_creation_with_diff_type():
    artifact_name = "a1-{}".format(str(time.time()))

    # create
    with wandb.init() as run:
        artifact = wandb.Artifact(artifact_name, "artifact_type_1")
        artifact.add(wandb.Image(np.random.randint(0, 255, (10, 10))), "image")
        run.log_artifact(artifact)

    # update
    with wandb.init() as run:
        artifact = wandb.Artifact(artifact_name, "artifact_type_1")
        artifact.add(wandb.Image(np.random.randint(0, 255, (10, 10))), "image")
        run.log_artifact(artifact)
    
    # invalid
    with wandb.init() as run:
        artifact = wandb.Artifact(artifact_name, "artifact_type_2")
        artifact.add(wandb.Image(np.random.randint(0, 255, (10, 10))), "image_2")
        did_err = False
        try:
            run.log_artifact(artifact)
        except ValueError as err:
            did_err = True
            assert str(err) == "Expected artifact type artifact_type_1, got artifact_type_2"
        assert did_err
        
    with wandb.init() as run:
        artifact = run.use_artifact(artifact_name + ":latest")
        # should work
        image = artifact.get("image")
        assert image is not None
        # should not work
        image_2 = artifact.get("image_2")
        assert image_2 is None


if __name__ == "__main__":
    try:
        test_artifact_creation_with_diff_type()
    finally:
        teardown()