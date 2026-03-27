#!/bin/bash
# Launch Kitty with tabs for C2 Farms development
# Usage: ./scripts/c2-dev.sh

cd /home/aristotle/c2farms

kitty \
  --title "C2 Farms Dev" \
  --tab-title "Claude Main" \
  --directory /home/aristotle/c2farms \
  claude \
  --new-tab --tab-title "Claude 2" \
  --directory /home/aristotle/c2farms \
  claude \
  --new-tab --tab-title "Backend" \
  --directory /home/aristotle/c2farms/backend \
  bash -c "npm run dev" \
  --new-tab --tab-title "Frontend" \
  --directory /home/aristotle/c2farms/frontend \
  bash -c "npm run dev" \
  --new-tab --tab-title "Shell" \
  --directory /home/aristotle/c2farms \
  &
