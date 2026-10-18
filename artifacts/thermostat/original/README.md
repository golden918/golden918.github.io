# Smart Thermostat CS-350 Portfolio Reflection

## Project Summary

For my final project, I built a smart thermostat prototype for a fictional company called SysTec. Using a Raspberry Pi, the thermostat reads the current temperature, lets the user switch between off, heat, and cool modes, adjust the target temperature, display information on an LCD, control LEDs to show system status, and send updates over UART every 30 seconds. Earlier in the course, I also created a Morse code transmitter that used a state machine to blink LEDs and switch between two messages with a button press.

## What I Did Well

I think the biggest strength of these projects was using state machines. They kept the code organized and made it easier to separate the system logic from the hardware controls. This made the projects much easier to understand and maintain than relying on large groups of if/else statements.

## What I Could Improve

This project helped me improve my debugging skills. I ran into a few Python bugs that took some time to track down, and I learned the importance of carefully reading error messages. I also want to get better at troubleshooting hardware issues like I2C communication without relying on step-by-step guides.

## Tools and Resources

One of the biggest lessons I learned was to use official documentation and datasheets instead of relying on summaries or memory. I also became more comfortable using tools like SCP to test and debug programs directly on the Raspberry Pi.

## Transferable Skills

The biggest skill I'll take from this course is learning to think in terms of state machines. That approach can be used in embedded systems, user interfaces, and backend software. I also gained experience comparing hardware options based on business requirements instead of just technical specifications.

## Maintainability

I kept my code organized with comments, clear method names, and separate classes for different responsibilities. Hardware-specific code was separated from the application logic, making it easier to modify or replace components without rewriting the entire program. That organization also made it easier to compare different hardware platforms in my architecture report.
