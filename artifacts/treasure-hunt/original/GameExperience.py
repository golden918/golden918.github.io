# Stores episodes between the initial and terminal state so the agent
# can learn by replaying past experience.

import numpy as np

class GameExperience(object):

    # target_model = stabilized network for Q-targets (falls back to model)
    # max_memory = episodes kept before the oldest is dropped
    # discount = weight on future vs. immediate reward

    def __init__(self, model, target_model=None, max_memory=100, discount=0.95):
        self.model = model
        self.target_model = target_model if target_model is not None else model
        self.max_memory = max_memory
        self.discount = discount
        self.memory = list()
        self.num_actions = model.output_shape[-1]

    # episode = [envstate, action, reward, envstate_next, game_over]
    def remember(self, episode):
        self.memory.append(episode)
        if len(self.memory) > self.max_memory:
            del self.memory[0]

    # Q-values for the given state
    def predict(self, envstate):
        return self.model.predict(envstate)[0]

    # Training batch: inputs + target Q-values
    def get_data(self, data_size=10):
        env_size = self.memory[0][0].shape[1]
        mem_size = len(self.memory)
        data_size = min(mem_size, data_size)
        inputs = np.zeros((data_size, env_size))
        targets = np.zeros((data_size, self.num_actions))
        for i, j in enumerate(np.random.choice(range(mem_size), data_size, replace=False)):
            envstate, action, reward, envstate_next, game_over = self.memory[j]
            inputs[i] = envstate
            targets[i] = self.predict(envstate)
            Q_sa = np.max(self.target_model.predict(envstate_next)[0])  # max future Q
            if game_over:
                targets[i, action] = reward
            else:
                targets[i, action] = reward + self.discount * Q_sa
        return inputs, targets
