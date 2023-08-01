#!/bin/bash

# Trap the SIGINT signal (Ctrl + C) to handle termination
trap 'handle_exit' SIGINT

# Function to handle script termination
handle_exit() {
  echo "Restoring original configs..."

  mv package.json.temp package.json
  mv forta.config.json.temp forta.config.json
  exit
}

echo "Building beta version of the bot..."

cp -f package.json package.json.temp
cp -f forta.config.json forta.config.json.temp

echo "Modifying package.json, forta.config.json, Dockerfile..."

npm pkg set 'name'='spam-detector-experimental'
npm pkg set 'description'='This is an experimental version of the spam detector bot.'
npm pkg delete "chainSettings"
npm pkg set 'chainSettings.default.shards'=1 --json
npm pkg set 'chainSettings.default.target'=3 --json

SOURCE_KEY="agentIdBeta"
DESTINATION_KEY="agentId"
JSON=$(cat forta.config.json)
SOURCE_VALUE=$(echo "$JSON" | jq -r ".$SOURCE_KEY")
# Use jq to insert the source value into the destination key
JSON=$(echo "$JSON" | jq --arg key "$DESTINATION_KEY" --arg value "$SOURCE_VALUE" '. + { ($key): $value }')
# Write the updated JSON back to the file
echo "$JSON" >forta.config.json

npm run publish

handle_exit