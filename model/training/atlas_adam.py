import numpy as np


class Adam:
    def __init__(
        self,
        learning_rate=0.001,
        beta1=0.9,
        beta2=0.999,
        epsilon=1e-8
    ):
        self.learning_rate = learning_rate
        self.beta1 = beta1
        self.beta2 = beta2
        self.epsilon = epsilon

        self.first_moment = {}
        self.second_moment = {}
        self.step_count = 0

    def update(self, parameters, gradients):

        if set(parameters) != set(gradients):
            raise ValueError("Parameter and gradient names must match.")

        # Validate everything before changing any parameter.
        for name, parameter in parameters.items():
            gradient = gradients[name]

            if parameter.shape != gradient.shape:
                raise ValueError(f"Shape mismatch: {name}")

            if not np.all(np.isfinite(gradient)):
                raise ValueError(f"Non-finite gradient: {name}")

        self.step_count += 1

        for name, parameter in parameters.items():

            gradient = gradients[name]

            if name not in self.first_moment:
                self.first_moment[name] = np.zeros_like(parameter)

                self.second_moment[name] = np.zeros_like(parameter)

            self.first_moment[name] = (
                self.beta1 * self.first_moment[name]
                + (1 - self.beta1) * gradient
            )

            self.second_moment[name] = (
                self.beta2 * self.second_moment[name]
                + (1 - self.beta2) * (gradient ** 2)
            )

            corrected_first = (
                self.first_moment[name]
                / (1 - self.beta1 ** self.step_count)
            )

            corrected_second = (
                self.second_moment[name]
                / (1 - self.beta2 ** self.step_count)
            )

            parameter -= (
                self.learning_rate
                * corrected_first
                / (np.sqrt(corrected_second) + self.epsilon)
            )

        return self.step_count
