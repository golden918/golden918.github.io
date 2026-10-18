# TreasureHuntGame_CalebBaker.py

# %% Cell 1 - imports
from __future__ import print_function
import os, sys, time, datetime, json, random
import numpy as np
import tensorflow as tf
from tensorflow.keras.models import clone_model
from keras.models import Sequential
from keras.layers import Dense, Activation, PReLU
from keras.optimizers import SGD, Adam, RMSprop
import matplotlib.pyplot as plt
from TreasureMaze import TreasureMaze
from GameExperience import GameExperience
# %matplotlib inline

# %% Cell 2 - maze layout (1 = open cell, 0 = wall)
maze = np.array([
    [ 1.,  0.,  1.,  1.,  1.,  1.,  1.,  1.],
    [ 1.,  0.,  1.,  1.,  1.,  0.,  1.,  1.],
    [ 1.,  1.,  1.,  1.,  0.,  1.,  0.,  1.],
    [ 1.,  1.,  1.,  0.,  1.,  1.,  1.,  1.],
    [ 1.,  1.,  0.,  1.,  1.,  1.,  1.,  1.],
    [ 1.,  1.,  1.,  0.,  1.,  0.,  0.,  0.],
    [ 1.,  1.,  1.,  0.,  1.,  1.,  1.,  1.],
    [ 1.,  1.,  1.,  1.,  0.,  1.,  1.,  1.]
])

# %% Cell 3 - render helper for the maze/pirate/treasure
def show(qmaze):
    plt.grid('on')
    nrows, ncols = qmaze.maze.shape
    ax = plt.gca()
    ax.set_xticks(np.arange(0.5, nrows, 1))
    ax.set_yticks(np.arange(0.5, ncols, 1))
    ax.set_xticklabels([])
    ax.set_yticklabels([])
    canvas = np.copy(qmaze.maze)
    for row, col in qmaze.visited:
        canvas[row, col] = 0.6
    pirate_row, pirate_col, _ = qmaze.state
    canvas[pirate_row, pirate_col] = 0.3   # pirate cell
    canvas[nrows-1, ncols-1] = 0.9  # treasure cell
    img = plt.imshow(canvas, interpolation='none', cmap='gray')
    return img

# %% Cell 4 - actions, exploration schedule
LEFT = 0
UP = 1
RIGHT = 2
DOWN = 3

# Exploration factor
epsilon = 1.0
epsilon_min = 0.05
epsilon_decay = 0.995
patience = 10

# Actions dictionary
actions_dict = {
    LEFT: 'left',
    UP: 'up',
    RIGHT: 'right',
    DOWN: 'down',
}

num_actions = len(actions_dict)

# %% Cell 5 - quick sanity check of the environment (demo cell)
qmaze = TreasureMaze(maze)
canvas, reward, game_over = qmaze.act(DOWN)
print("reward=", reward)
show(qmaze)

# %% Cell 6 - greedy evaluation of a trained model from one starting cell
def play_game(model, qmaze, pirate_cell, max_steps=None):
    qmaze.reset(pirate_cell)
    envstate = qmaze.observe()
    steps = 0
    if max_steps is None:
        max_steps = qmaze.maze.size * 4  # safety cutoff

    while steps < max_steps:
        state = np.asarray(envstate, dtype=np.float32)
        if state.ndim == 1:
            state = np.expand_dims(state, axis=0)

        q_values = model(state, training=False).numpy()
        action = np.argmax(q_values[0])

        envstate, reward, game_status = qmaze.act(action)
        steps += 1

        if game_status == 'win':
            return True
        elif game_status == 'lose':
            return False

    return False  # timed out with no result

# %% Cell 7 - check that the model wins from every free cell
def completion_check(model, maze_or_qmaze, max_steps=None):
    # Accept either raw numpy maze or TreasureMaze instance
    if isinstance(maze_or_qmaze, TreasureMaze):
        qmaze = maze_or_qmaze
    else:
        qmaze = TreasureMaze(maze_or_qmaze)

    for cell in qmaze.free_cells:
        if not qmaze.valid_actions(cell):
            continue
        if not play_game(model, qmaze, cell, max_steps=max_steps):
            return False
    return True

# %% Cell 8 - the Q-network
def build_model(maze):
    model = Sequential()
    model.add(Dense(maze.size, input_shape=(maze.size,)))
    model.add(PReLU())
    model.add(Dense(maze.size))
    model.add(PReLU())
    model.add(Dense(num_actions))
    model.compile(optimizer='adam', loss='mse')
    return model

# %% Cell 9 - one training step (custom GradientTape loop)
loss_fn = tf.keras.losses.MeanSquaredError()
optimizer = tf.keras.optimizers.Adam()

@tf.function
def train_step(x, y):
    with tf.GradientTape() as tape:
        q_values = model(x, training=True)
        loss = loss_fn(y, q_values)
    grads = tape.gradient(loss, model.trainable_variables)
    optimizer.apply_gradients(zip(grads, model.trainable_variables))
    return loss

# %% Cell 10 - the training loop (this is the core of the assignment)
def qtrain(model, maze, **opt):
    # exploration factor
    global epsilon

    # Number of epochs
    n_epoch = opt.get('n_epoch', 15000)

    # Maximum memory to store episodes
    max_memory = opt.get('max_memory', 1000)

    # Maximum data size for training
    data_size = opt.get('data_size', 50)

    # Frequency of target network updates
    target_update_freq = opt.get('target_update_freq', 50)

    # Start time
    start_time = datetime.datetime.now()

    # Construct environment/game from numpy array: maze (see argument above)
    qmaze = TreasureMaze(maze)

    # Target Network to better guide training
    target_model = clone_model(model)
    target_model.set_weights(model.get_weights())

    # Initialize experience replay object
    experience = GameExperience(model, target_model, max_memory=max_memory)

    win_history = []  # history of win/lose game
    hsize = qmaze.maze.size // 2  # history window size
    win_rate = 0.0

    # =============START_HERE================
    # Initialize counters used below
    n_episodes = 0  # total number of games
    loss = 0.0      # running loss for current epoch

    for epoch in range(n_epoch):
        # Randomly select one of the maze's free cells as the pirate's starting point
        agent_cell = random.choice(qmaze.free_cells)

        # Reset the maze env to the chosen starting cell
        qmaze.reset(agent_cell)

        # Capture the initial env state
        env_state = qmaze.observe()

        # Reset per-epoch loss accumulator and step counter
        loss = 0.0
        n_steps = 0  # steps taken in this epoch's game

        # Inner game loop. Runs until the game is won or lost
        game_status = 'not_over'
        while game_status == 'not_over':

            # Save the state before taking action
            previous_envstate = env_state

            # Exploration vs exploitation decision using epsilon-greedy policy
            if np.random.rand() < epsilon:
                # Exploration: Randomly choose valid action
                action = random.choice(qmaze.valid_actions())
            else:
                # Exploitation: predict the best action based on env state
                action = np.argmax(experience.predict(env_state))

            # Take the action and observe the resulting state, reward, and see if the game has ended.
            env_state, reward, game_status = qmaze.act(action)

            # Record win (1) or loss (0) in the history buffer once the game ends
            if game_status == 'win':
                win_history.append(1)
                n_episodes += 1
            elif game_status == 'lose':
                win_history.append(0)
                n_episodes += 1

            # Store this transition in the experience replay memory
            episode = [previous_envstate, action, reward, env_state, game_status]
            experience.remember(episode)

            # Sample from experience replay and train the network
            inputs, targets = experience.get_data(data_size)
            batch_loss = train_step(inputs, targets)

            # Accumulate the loss value and step count for reporting
            loss += float(batch_loss)
            n_steps += 1

        # Average the loss over the steps taken this epoch
        loss = loss / n_steps if n_steps > 0 else 0.0

        # Periodically copy model weights into the target network and stabilize Q-value estimates
        if epoch % target_update_freq == 0:
            target_model.set_weights(model.get_weights())

        # Win rate over last hsize steps
        win_rate = sum(win_history[-hsize:]) / hsize if len(win_history) >= hsize else 0.0

        # Print the epoch, loss, episode, win count, win rate, and time for each epoch
        dt = datetime.datetime.now() - start_time
        t = format_time(dt.total_seconds())
        print("Epoch: {:03d}/{:d} | Loss: {:.4f} | Episodes: {:d} | Win count: {:d} | Win rate: {:.3f} | time: {}".format(
            epoch, n_epoch-1, loss, n_episodes, sum(win_history), win_rate, t))

        # Check if training has exhausted all free cells and if in all
        # cases the agent won
        if win_rate > 0.9:
            epsilon = 0.05
        else:
            epsilon = max(epsilon * epsilon_decay, epsilon_min)

        if win_rate >= 0.999 and completion_check(model, maze):
            print(f"Reached 100% win rate at epoch {epoch}")
            break

    total_time = format_time((datetime.datetime.now() - start_time).total_seconds())
    print("Training complete in:", total_time)


# This is a small utility for printing readable time strings:
def format_time(seconds):
    if seconds < 400:
        s = float(seconds)
        return "%.1f seconds" % (s,)
    elif seconds < 4000:
        m = seconds / 60.0
        return "%.2f minutes" % (m,)
    else:
        h = seconds / 3600.0
        return "%.2f hours" % (h,)

# %% Cell 11 - reset the demo maze before training (demo cell)
qmaze = TreasureMaze(maze)
show(qmaze)

# %% Cell 12 - build the model and run training
model = build_model(maze)
qtrain(model, maze, n_epoch=1000, max_memory=8*maze.size, data_size=32, target_update_freq=50)

# %% Cell 13 - confirm the trained model wins from every free cell (demo cell)
completion_check(model, qmaze)
show(qmaze)

# %% Cell 14 - play one game from the top-left corner and show the result (demo cell)
pirate_start = (0, 0)
play_game(model, qmaze, pirate_start)
show(qmaze)
