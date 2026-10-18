#
# Thermostat - Enhanced for CS 499 Milestone Two 
#
# What changed from the original CS 350 submission:
#
#   1. The hardware-facing code (sensor, LEDs, LCD, serial) is now behind
#      a small HardwareInterface class instead of being called directly
#      from inside TemperatureMachine via module-level globals.
#      TemperatureMachine takes a HardwareInterface in its constructor
#      (dependency injection), so it can run against a fake hardware
#      implementation in unit tests with no physical board attached.
#   2. Every hardware library that RaspberryPiHardware needs (board,
#      digitalio, adafruit_ahtx0, adafruit_character_lcd, serial,
#      gpiozero) is imported lazily, inside RaspberryPiHardware.__init__
#      and main(), instead of at the top of the file. That's what lets
#      this file import and run on a machine without those hardware libraries installed.
#   3. Sensor reads and serial writes are wrapped in try/except and log a
#      warning instead of crashing the display thread on a transient
#      hardware failure.
#   4. The magic-number thresholds that used to control the display's
#      timing (30, 6, 11) are now named constants.
#   5. The setpoint can no longer be pushed to an unbounded value, it's
#      clamped between MIN_SETPOINT_F and MAX_SETPOINT_F.
#   6. The display thread is joined on shutdown instead of being left to
#      finish (or not) on its own.
#   7. Debug output goes through the standard `logging` module instead of
#      print() behind a hardcoded DEBUG flag, so verbosity is configurable
#      without editing source.
#
#Caleb Baker
#------------------------------------------------------------------
# Change History
#------------------------------------------------------------------
# Version   |   Description
#------------------------------------------------------------------
#    1          Initial Development (CS 350)
#    2          CS 499 Milestone Two: added HardwareInterface /
#               RaspberryPiHardware (hardware imports now lazy),
#               error handling, unit tests, named constants,
#               setpoint bounds, thread join on shutdown
#------------------------------------------------------------------

import logging
from abc import ABC, abstractmethod
from math import floor
from datetime import datetime
from threading import Thread
from time import sleep
 
from statemachine import StateMachine, State
 
logger = logging.getLogger("thermostat")

##
## Named constants (previously magic numbers scattered through the display
## loop with no explanation of what they controlled).
##
DEFAULT_SETPOINT_F = 72
MIN_SETPOINT_F = 50
MAX_SETPOINT_F = 99
 
SERIAL_REPORT_INTERVAL_SEC = 30      # how often a status report is sent
DISPLAY_REFRESH_INTERVAL_SEC = 1     # how often the display loop wakes up
TEMP_DISPLAY_DURATION_TICKS = 5      # ticks the LCD shows the temperature
STATE_DISPLAY_DURATION_TICKS = 5     # ticks the LCD shows state + setpoint
LIGHT_REFRESH_CYCLE_TICKS = (
    TEMP_DISPLAY_DURATION_TICKS + STATE_DISPLAY_DURATION_TICKS
)  # full temp-then-state cycle before the lights are re-evaluated


# ---------------------------------------------------------------------------
# Hardware abstraction. TemperatureMachine (below) only ever calls methods
# on a HardwareInterface, it never imports board/gpiozero/adafruit_*,
# which is what lets it be unit tested without a Raspberry Pi attached.
# ---------------------------------------------------------------------------
##
## HardwareReadError - Raised when a physical sensor/serial/display
## operation fails. TemperatureMachine catches this at the call site and
## logs a warning instead of letting the underlying hardware exception
## (I2C error, serial exception, etc.) propagate and kill the display
## thread, which is what the original implementation did.
##
class HardwareReadError(Exception):
    pass
 
 
##
## HardwareInterface - Everything the thermostat's control logic needs
## from the outside world, boiled down to a small, mockable surface.
##
class HardwareInterface(ABC):
 
    ## read_fahrenheit - Return the current temperature reading in
    ## degrees Fahrenheit. Raises HardwareReadError if the sensor cannot
    ## be read.
    @abstractmethod
    def read_fahrenheit(self) -> float:
        raise NotImplementedError
 
    ## set_heat_led - Turn the heat (red) indicator fully on or fully off.
    @abstractmethod
    def set_heat_led(self, on: bool) -> None:
        raise NotImplementedError
 
    ## pulse_heat_led - Pulse the heat (red) indicator to show active
    ## heating.
    @abstractmethod
    def pulse_heat_led(self) -> None:
        raise NotImplementedError
 
    ## set_cool_led - Turn the cool (blue) indicator fully on or fully off.
    @abstractmethod
    def set_cool_led(self, on: bool) -> None:
        raise NotImplementedError
 
    ## pulse_cool_led - Pulse the cool (blue) indicator to show active
    ## cooling.
    @abstractmethod
    def pulse_cool_led(self) -> None:
        raise NotImplementedError
 
    ## update_display - Write two lines of text to the thermostat's LCD.
    @abstractmethod
    def update_display(self, line1: str, line2: str) -> None:
        raise NotImplementedError
 
    ## cleanup_display - Release the display's GPIO lines on shutdown.
    @abstractmethod
    def cleanup_display(self) -> None:
        raise NotImplementedError
 
    ## report_status - Send a status update over the reporting channel
    ## (serial, in the Raspberry Pi implementation). Raises
    ## HardwareReadError if the report could not be sent.
    @abstractmethod
    def report_status(self, state_id: str, temp_f: float, setpoint_f: int) -> None:
        raise NotImplementedError
 
 
##
## RaspberryPiHardware - Talks to the real thermostat circuit (AHT20
## sensor over I2C, two PWM status LEDs, a 16x2 character LCD, and a
## UART serial connection).
##
## This is the only part of the file that needs Raspberry Pi / GPIO / I2C
## libraries, and it only imports them here, inside __init__, not at
## module load time, so the rest of the file (and the unit tests) can
## be imported and run on any machine.
##
class RaspberryPiHardware(HardwareInterface):
 
    SERIAL_PORT = "/dev/ttyS0"
    SERIAL_BAUDRATE = 115200
 
    def __init__(self):
        import board
        import digitalio
        import adafruit_ahtx0
        import adafruit_character_lcd.character_lcd as characterlcd
        import serial
        from gpiozero import PWMLED
 
        self._serial_module = serial
 
        i2c = board.I2C()
        self._temp_sensor = adafruit_ahtx0.AHTx0(i2c)
 
        self._serial = serial.Serial(
            port=self.SERIAL_PORT,
            baudrate=self.SERIAL_BAUDRATE,
            parity=serial.PARITY_NONE,
            stopbits=serial.STOPBITS_ONE,
            bytesize=serial.EIGHTBITS,
            timeout=1,
        )
 
        self._red_light = PWMLED(18)
        self._blue_light = PWMLED(23)
 
        # LCD setup (mirrors the original ManagedDisplay class)
        self._lcd_rs = digitalio.DigitalInOut(board.D17)
        self._lcd_en = digitalio.DigitalInOut(board.D27)
        self._lcd_d4 = digitalio.DigitalInOut(board.D5)
        self._lcd_d5 = digitalio.DigitalInOut(board.D6)
        self._lcd_d6 = digitalio.DigitalInOut(board.D13)
        self._lcd_d7 = digitalio.DigitalInOut(board.D26)
 
        self._lcd = characterlcd.Character_LCD_Mono(
            self._lcd_rs, self._lcd_en,
            self._lcd_d4, self._lcd_d5, self._lcd_d6, self._lcd_d7,
            16, 2,
        )
        self._lcd.clear()
 
    def read_fahrenheit(self) -> float:
        try:
            celsius = self._temp_sensor.temperature
        except Exception as exc:  # noqa: BLE001 - hardware can fail in many ways
            logger.warning("Sensor read failed: %s", exc)
            raise HardwareReadError("Unable to read temperature sensor") from exc
        return (celsius * 9 / 5) + 32
 
    def set_heat_led(self, on: bool) -> None:
        self._red_light.on() if on else self._red_light.off()
 
    def pulse_heat_led(self) -> None:
        self._red_light.pulse()
 
    def set_cool_led(self, on: bool) -> None:
        self._blue_light.on() if on else self._blue_light.off()
 
    def pulse_cool_led(self) -> None:
        self._blue_light.pulse()
 
    def update_display(self, line1: str, line2: str) -> None:
        self._lcd.clear()
        self._lcd.message = line1 + "\n" + line2
 
    def cleanup_display(self) -> None:
        self._lcd.clear()
        self._lcd_rs.deinit()
        self._lcd_en.deinit()
        self._lcd_d4.deinit()
        self._lcd_d5.deinit()
        self._lcd_d6.deinit()
        self._lcd_d7.deinit()
 
    def report_status(self, state_id: str, temp_f: float, setpoint_f: int) -> None:
        message = f"{state_id},{temp_f},{setpoint_f}\n"
        try:
            self._serial.write(message.encode())
        except Exception as exc:  # noqa: BLE001
            logger.warning("Serial report failed: %s", exc)
            raise HardwareReadError("Unable to write status over serial") from exc
 
 
class TemperatureMachine(StateMachine):
    "A state machine designed to manage our thermostat"
 
    ##
    ## Define the three states for our machine.
    ##
    ##  off - nothing lit up
    ##  heat - red LED fading in and out (or solid at setpoint)
    ##  cool - blue LED fading in and out (or solid at setpoint)
    ##
    off = State(initial=True)
    heat = State()
    cool = State()
 
    ##
    ## cycle - event that provides the state machine behavior
    ## of transitioning between the three states of our thermostat
    ##
    cycle = (
        off.to(heat) |
        heat.to(cool) |
        cool.to(off)
    )
 
    def __init__(self, hw: HardwareInterface):
        self.hw = hw
        self.setPoint = DEFAULT_SETPOINT_F
        self.endDisplay = False
        super().__init__()
 
    ##
    ## on_enter_heat / on_exit_heat - Actions performed when the state
    ## machine transitions into and out of the 'heat' state
    ##
    def on_enter_heat(self):
        self.updateLights()
        logger.debug("Changing state to heat")
 
    def on_exit_heat(self):
        self.hw.set_heat_led(False)
 
    ##
    ## on_enter_cool / on_exit_cool - Actions performed when the state
    ## machine transitions into and out of the 'cool' state
    ##
    def on_enter_cool(self):
        self.updateLights()
        logger.debug("Changing state to cool")
 
    def on_exit_cool(self):
        self.hw.set_cool_led(False)
 
    ##
    ## on_enter_off - Action performed when the state machine transitions
    ## into the 'off' state
    ##
    def on_enter_off(self):
        self.hw.set_heat_led(False)
        self.hw.set_cool_led(False)
        logger.debug("Changing state to off")
 
    ##
    ## processTempStateButton - Utility method used to send events to the
    ## state machine. This is triggered by the button_pressed event
    ## handler for our first button
    ##
    def processTempStateButton(self):
        logger.debug("Cycling Temperature State")
        self.cycle()
 
    ##
    ## processTempIncButton / processTempDecButton - Utility methods used
    ## to update the setPoint for the temperature, clamped to a sane range
    ## so it can't be pushed to an unrealistic value.
    ##
    def processTempIncButton(self):
        self.setPoint = min(self.setPoint + 1, MAX_SETPOINT_F)
        logger.debug("Increasing Set Point to %s", self.setPoint)
        self.updateLights()
 
    def processTempDecButton(self):
        self.setPoint = max(self.setPoint - 1, MIN_SETPOINT_F)
        logger.debug("Decreasing Set Point to %s", self.setPoint)
        self.updateLights()
 
    ##
    ## updateLights - Utility method to update the LED indicators on the
    ## Thermostat based on the current temperature vs. the setpoint.
    ##
    def updateLights(self):
        temp = self._safe_read_fahrenheit()
        if temp is None:
            # Sensor read failed; leave the lights as they are rather than
            # guessing, and the failure has already been logged.
            return
 
        temp = floor(temp)
        self.hw.set_heat_led(False)
        self.hw.set_cool_led(False)
 
        logger.debug(
            "State: %s | SetPoint: %s | Temp: %s",
            self.current_state.id, self.setPoint, temp,
        )
 
        if self.current_state.id == "heat":
            if temp < self.setPoint:
                self.hw.pulse_heat_led()
            else:
                self.hw.set_heat_led(True)
        elif self.current_state.id == "cool":
            if temp > self.setPoint:
                self.hw.pulse_cool_led()
            else:
                self.hw.set_cool_led(True)
 
    ##
    ## run - kickoff the display management functionality of the thermostat
    ##
    def run(self):
        self._displayThread = Thread(target=self.manageMyDisplay)
        self._displayThread.start()
 
    ##
    ## stop - Signal the display thread to stop and wait for it to
    ## finish, instead of leaving it to exit on its own (or not) as the
    ## original implementation did.
    ##
    def stop(self):
        self.endDisplay = True
        if hasattr(self, "_displayThread"):
            self._displayThread.join(timeout=DISPLAY_REFRESH_INTERVAL_SEC * 2)
 
    ##
    ## getFahrenheit / _safe_read_fahrenheit - Get the temperature in
    ## Fahrenheit from the hardware layer, logging a warning instead of
    ## raising if the sensor can't be read.
    ##
    def getFahrenheit(self):
        return self.hw.read_fahrenheit()
 
    def _safe_read_fahrenheit(self):
        try:
            return self.getFahrenheit()
        except HardwareReadError:
            return None
 
    ##
    ## manageMyDisplay - This function is designed to manage the LCD
    ## Display and the periodic serial status report.
    ##
    def manageMyDisplay(self):
        counter = 1
        altCounter = 1
        while not self.endDisplay:
            logger.debug("Processing Display Info...")
 
            current_time = datetime.now()
            lcd_line_1 = current_time.strftime("%Y-%m-%d %H:%M:%S")
 
            if altCounter <= TEMP_DISPLAY_DURATION_TICKS:
                temp = self._safe_read_fahrenheit()
                lcd_line_2 = (
                    "Temp: %.1f F" % temp if temp is not None else "Temp: -- F"
                )
            else:
                lcd_line_2 = f"{self.current_state.id} {self.setPoint} F"
 
            altCounter += 1
            if altCounter > LIGHT_REFRESH_CYCLE_TICKS:
                self.updateLights()
                altCounter = 1
 
            self.hw.update_display(lcd_line_1, lcd_line_2)
 
            logger.debug("Counter: %s", counter)
            if counter % SERIAL_REPORT_INTERVAL_SEC == 0:
                temp = self._safe_read_fahrenheit()
                if temp is not None:
                    try:
                        self.hw.report_status(
                            self.current_state.id, temp, self.setPoint
                        )
                    except HardwareReadError:
                        pass  # already logged by the hardware layer
                counter = 1
            else:
                counter += 1
 
            sleep(DISPLAY_REFRESH_INTERVAL_SEC)
 
        self.hw.cleanup_display()
 
 
def main():
    logging.basicConfig(level=logging.INFO)
 
    # gpiozero.Button is only needed here, for the physical control
    # buttons imported lazily so the rest of the module stays free of
    # any Raspberry Pi / GPIO dependency.
    from gpiozero import Button
 
    hw = RaspberryPiHardware()
    tsm = TemperatureMachine(hw)
    tsm.run()
 
    greenButton = Button(24)
    greenButton.when_pressed = tsm.processTempStateButton
 
    redButton = Button(25)
    redButton.when_pressed = tsm.processTempIncButton
 
    blueButton = Button(12)
    blueButton.when_pressed = tsm.processTempDecButton
 
    repeat = True
    while repeat:
        try:
            sleep(30)
        except KeyboardInterrupt:
            logger.info("Cleaning up. Exiting...")
            repeat = False
            tsm.stop()
 
 
if __name__ == "__main__":
    main()