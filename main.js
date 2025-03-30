const ethers = require("ethers");
const prompts = require("prompts");

const availableScripts = [
  { title: "1. Rubics (Swap)", value: "rubic" },
  { title: "2. Izumi (Swap)", value: "izumi" },
  { title: "3. Beanswap (Swap)", value: "beanswap" },
  { title: "4. Magma (Stake)", value: "magma" },
  { title: "5. Apriori (Stake)", value: "apriori" },
  { title: "6. Monorail (Swap)", value: "monorail" },
  { title: "7. Ambient (Swap) (noauto)", value: "ambient" },
  { title: "8. Deploy Contract (noauto)", value: "deployct" },
  { title: "9. Kintsu (Stake)", value: "kintsu" },
  { title: "10. Shmonad (Stake)", value: "shmonad" },
  { title: "11. Octoswap (Swap)", value: "octoswap" },
  { title: "Run auto sequentially 1-6", value: "all" },
  { title: "Run auto sequentially 1-6, 9, 10, and 11", value: "all-with-kintsu-shmonad" },
  { title: "Exit", value: "exit" },
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scriptConfigs = {
  rubic: { cycles: 1, intervalHours: null },
  magma: { cycles: 1, intervalHours: null },
  izumi: { cycles: 1, intervalHours: null },
  apriori: { cycles: 1, intervalHours: null },
  beanswap: { cycles: 1, intervalHours: null },
  monorail: { cycles: 1, intervalHours: null },
  ambient: { cycles: 1, intervalHours: null },
  kintsu: { cycles: 1, intervalHours: null, tokenId: 1 },
  shmonad: { cycles: 1, intervalHours: null },
  octoswap: { cycles: 1, intervalHours: null }
};

async function runScript(scriptName, automated = false) {
  try {
    let scriptModule;
    
    switch (scriptName) {
      case "rubic":
        console.log("Running Rubics (Swap)...");
        scriptModule = require("./scripts/rubic");
        break;

      case "magma":
        console.log("Running Magma (Stake)...");
        scriptModule = require("./scripts/magma");
        break;

      case "izumi":
        console.log("Running Izumi (Swap)...");
        scriptModule = require("./scripts/izumi");
        break;

      case "apriori":
        console.log("Running Apriori (Stake)...");
        scriptModule = require("./scripts/apriori");
        break;
        
      case "beanswap":
        console.log("Running Beanswap (Swap)...");
        scriptModule = require("./scripts/beanswap");
        break;
        
      case "monorail":
        console.log("Running Monorail (Swap)...");
        scriptModule = require("./scripts/monorail");
        break;
        
      case "ambient":
        console.log("RunningAmbient (Swap)...");
        scriptModule = require("./scripts/ambient");
        break;
        
      case "deployct":
        console.log("Running Deploy Contract...");
        scriptModule = require("./scripts/deployct");
        break;
        
      case "kintsu":
        console.log("Running Kintsu (Stake)...");
        scriptModule = require("./scripts/kintsu");
        break;
        
      case "shmonad":
        console.log("Running Shmonad (Stake)...");
        scriptModule = require("./scripts/shmonad");
        break;
        
      case "octoswap":
        console.log("Running Octoswap (Swap)...");
        scriptModule = require("./scripts/octoswap");
        break;

      default:
        console.log(`Unknown script: ${scriptName}`);
        return;
    }
    
    if (scriptName === "ambient" || scriptName === "deployct") {
      automated = false;
    }
    
    if (automated && scriptModule.runAutomated) {
      if (scriptName === "kintsu") {
        await scriptModule.runAutomated(
          scriptConfigs[scriptName].cycles, 
          scriptConfigs[scriptName].tokenId,
          scriptConfigs[scriptName].intervalHours
        );
      } else {
        await scriptModule.runAutomated(
          scriptConfigs[scriptName].cycles, 
          scriptConfigs[scriptName].intervalHours
        );
      }
    } else if (automated) {
      console.log(`Warning: ${scriptName} script does not support auto mode.`);
      await scriptModule.run();
    } else {
      await scriptModule.run();
    }
  } catch (error) {
    console.error(`Unable to run ${scriptName} script:`, error.message);
  }
}

async function runAllScriptsSequentially(includeKintsu = false, includeShmonad = false) {
  let scriptOrder = ["rubic", "izumi", "beanswap", "magma", "apriori", "monorail"];
  
  if (includeKintsu) {
    scriptOrder.push("kintsu");
  }
  
  if (includeShmonad) {
    scriptOrder.push("shmonad");
    scriptOrder.push("octoswap");
  }
  
  console.log("-".repeat(60));
  let automationMessage = "Currently in auto mode, running sequentially ";
  
  if (includeKintsu && includeShmonad) {
    automationMessage += "from 1-6, 9, 10, and 11";
  } else {
    automationMessage += "from 1-6";
  }
  
  console.log(automationMessage);
  console.log("-".repeat(60));
  
  const response = await prompts([
    {
      type: 'number',
      name: 'cycles',
      message: 'How many cycles do you want to run for each script?',
      initial: 1
    },
    {
      type: 'number',
      name: 'intervalHours',
      message: 'Run interval in hours (0 if no repeat):',
      initial: 0
    }
  ]);
  
  if (includeKintsu) {
    const tokenIdResponse = await prompts({
      type: 'number',
      name: 'tokenId',
      message: 'Enter token ID for kintsu (default: 1):',
      initial: 1
    });
    
    scriptConfigs.kintsu.tokenId = tokenIdResponse.tokenId || 1;
  }
  
  for (const script of scriptOrder) {
    scriptConfigs[script].cycles = response.cycles || 1;
    scriptConfigs[script].intervalHours = response.intervalHours > 0 ? response.intervalHours : null;
  }
  
  for (let i = 0; i < scriptOrder.length; i++) {
    const scriptName = scriptOrder[i];
    console.log(`\n[${i + 1}/${scriptOrder.length}] Starting to run ${scriptName.toUpperCase()}...`);
    
    await runScript(scriptName, true);
    
    if (i < scriptOrder.length - 1) {
      console.log(`\nFinished running ${scriptName.toUpperCase()}. Waiting 5 seconds before continuing...`);
      await delay(5000);
    } else {
      console.log(`\nFinished running ${scriptName.toUpperCase()}.`);
    }
  }
  
  console.log("-".repeat(60));
  console.log("All scripts completed");
  console.log("-".repeat(60));
}

async function run() {
  console.log('═══════════════════════════════════════');
  console.log('Monad Auto Bot - Airdrop Toolkit Hub');
  console.log('Channel Telegram : https://t.me/AirdropToolkitHub');
  console.log('═══════════════════════════════════════');
  const response = await prompts({
    type: "select",
    name: "script",
    message: "Choose any to start running:",
    choices: availableScripts,
  });

  const selectedScript = response.script;

  if (!selectedScript) {
    console.log("No script selected. Stopping bot...");
    return;
  }

  if (selectedScript === "all") {
    await runAllScriptsSequentially(false, false);
  } else if (selectedScript === "all-with-kintsu-shmonad") {
    await runAllScriptsSequentially(true, true);
  } else if (selectedScript === "exit") {
    console.log("Stopping bot...");
    process.exit(0);
  } else {
    await runScript(selectedScript);
  }
}

run().catch((error) => {
  console.error("Error occurred:", error);
});

module.exports = { runScript, runAllScriptsSequentially };