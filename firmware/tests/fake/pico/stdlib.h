#pragma once
#include <stdbool.h>
#include <stdint.h>
typedef uint32_t absolute_time_t;
absolute_time_t get_absolute_time(void);
uint32_t to_ms_since_boot(absolute_time_t t);
void sleep_ms(uint32_t ms);
void gpio_init(uint32_t pin);
void gpio_set_dir(uint32_t pin, bool out);
void gpio_pull_up(uint32_t pin);
bool gpio_get(uint32_t pin);
void gpio_put(uint32_t pin, bool value);
#define GPIO_OUT true
#define GPIO_IN false
