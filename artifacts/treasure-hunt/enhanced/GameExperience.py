# GameExperience - Enhanced for CS 499 Milestone Three (Algorithms and
# Data Structures). Same role as the original: stores episodes and hands
# back a training batch.
#
# Changes from the original:
#   1. Fixed-size circular buffer (SumTree's _buffer) instead of a list +
#      del memory[0] -- O(1) eviction instead of O(n).
#   2. Prioritized Experience Replay (Schaul et al. 2015): episodes are
#      sampled by priority (from TD-error) via a sum tree, O(log n),
#      instead of uniform random sampling over the whole list.

import numpy as np


# SumTree - binary tree where each parent = sum of its children; leaves
# hold each episode's priority, so sampling by priority is an O(log n)
# walk instead of an O(n) scan. Fixed-size circular buffer: wraps and
# overwrites the oldest entry once full.
class SumTree:

    def __init__(self, capacity):
        self.capacity = capacity
        self.tree = np.zeros(2 * capacity - 1)
        self._buffer = np.empty(capacity, dtype=object)
        self._write = 0
        self.n_entries = 0

    def total(self):
        return self.tree[0]

    # Store data at the given priority, overwriting the oldest slot if full
    def add(self, priority, data):
        tree_idx = self._write + self.capacity - 1
        self._buffer[self._write] = data
        self.update(tree_idx, priority)

        self._write += 1
        if self._write >= self.capacity:
            self._write = 0
        if self.n_entries < self.capacity:
            self.n_entries += 1

    # Update a leaf's priority and propagate the change up to the root
    def update(self, tree_idx, priority):
        change = priority - self.tree[tree_idx]
        self.tree[tree_idx] = priority
        parent = tree_idx
        while parent != 0:
            parent = (parent - 1) // 2
            self.tree[parent] += change

    # Walk to the leaf covering `sample` (0..total()) -- higher-priority
    # leaves cover a wider range, so they're picked more often
    def get(self, sample):
        idx = 0
        while True:
            left = 2 * idx + 1
            right = left + 1
            if left >= len(self.tree):
                break
            if sample <= self.tree[left]:
                idx = left
            else:
                sample -= self.tree[left]
                idx = right
        data_idx = idx - self.capacity + 1
        return idx, self.tree[idx], self._buffer[data_idx]


# GameExperience - same public interface as the original, backed by a
# SumTree instead of a plain list.
class GameExperience(object):

    PRIORITY_ALPHA = 0.6    # TD-error's influence on sampling (0=uniform, 1=greedy)
    PRIORITY_EPSILON = 0.01 # priority floor so 0-error episodes can still be sampled

    # target_model = stabilized network for Q-targets (falls back to model)
    # max_memory = episode capacity; discount = future vs. immediate reward weight

    def __init__(self, model, target_model=None, max_memory=100, discount=0.95):
        self.model = model
        self.target_model = target_model if target_model is not None else model
        self.discount = discount
        self.num_actions = model.output_shape[-1]

        self.tree = SumTree(max_memory)
        self._env_size = None
        self._max_priority = 1.0  # new episodes start at max priority

    # Store an episode at the current max priority
    def remember(self, episode):
        if self._env_size is None:
            self._env_size = episode[0].shape[1]
        priority = self._max_priority ** self.PRIORITY_ALPHA
        self.tree.add(priority, episode)

    # Q-values for the given state
    def predict(self, envstate):
        return self.model.predict(envstate)[0]

    # Sample a batch by priority, compute target Q-values, then update
    # each sampled episode's priority from its TD-error
    def get_data(self, data_size=10):
        data_size = min(self.tree.n_entries, data_size)
        inputs = np.zeros((data_size, self._env_size))
        targets = np.zeros((data_size, self.num_actions))

        for i in range(data_size):
            sample = np.random.uniform(0, self.tree.total())
            tree_idx, _priority, episode = self.tree.get(sample)
            envstate, action, reward, envstate_next, game_over = episode

            inputs[i] = envstate
            targets[i] = self.predict(envstate)

            Q_sa = np.max(self.target_model.predict(envstate_next)[0])  # max future Q, from target net
            if game_over:
                target_value = reward
            else:
                target_value = reward + self.discount * Q_sa

            td_error = abs(target_value - targets[i, action])  # becomes this episode's new priority
            targets[i, action] = target_value

            priority = (td_error + self.PRIORITY_EPSILON) ** self.PRIORITY_ALPHA
            self.tree.update(tree_idx, priority)
            self._max_priority = max(self._max_priority, priority)

        return inputs, targets
