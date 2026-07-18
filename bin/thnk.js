#!/usr/bin/env node

require("../scripts/m2/cli")
  .main(process.argv.slice(2))
  .catch((error) => {
    console.error(`THNK: ${error.message}`);
    process.exitCode = 1;
  });
