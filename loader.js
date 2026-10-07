const temperatureCardLoadTimestamp = Date.now();

import(
  `/local/temperature-card/temperature-card.js?ts=${temperatureCardLoadTimestamp}`
)
  .catch((error) => {
    console.error("Failed to load temperature card:", error);
  });
