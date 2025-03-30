const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');

const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

function readPrivateKeys() {
  try {
    const data = fs.readFileSync(WALLET_FILE, 'utf8');
    const privateKeys = data.split('\n')
      .map(key => key.trim())
      .filter(key => key !== '');
    
    return privateKeys;
  } catch (error) {
    console.error(`❌ Could not read wallet.txt file: ${error.message}`.red);
    process.exit(1);
  }
}

async function getRandomAmount(wallet) {
  try {
    const balance = await wallet.getBalance();
    
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    
    const minBasisPoints = Math.floor(minPercentage * 100);
    const maxBasisPoints = Math.floor(maxPercentage * 100);
    
    const min = balance.mul(minBasisPoints).div(10000);
    const max = balance.mul(maxBasisPoints).div(10000);
    
    const minAmount = ethers.utils.parseEther(config.minimumTransactionAmount);
    if (min.lt(minAmount)) {
      console.log("⚠️ Balance too low, using minimum amount".yellow);
      return minAmount;
    }
    
    if (max.lte(min)) {
      console.log("⚠️ Transaction range too small, using minimum amount".yellow);
      return min;
    }
    
    const range = max.sub(min);
    
    const randomBytes = ethers.utils.randomBytes(32);
    const randomBN = ethers.BigNumber.from(randomBytes);
    const randomValue = randomBN.mod(range);
    
    const amount = min.add(randomValue);
    
    console.log(`💰 Transaction amount: ${ethers.utils.formatEther(amount)} MON`.cyan);
    return amount;
  } catch (error) {
    console.error("❌ Error calculating random amount:".red, error);
    console.log(`⚠️ Using default amount: ${config.defaultTransactionAmount} MON`.yellow);
    return ethers.utils.parseEther(config.defaultTransactionAmount);
  }
}


function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 1 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

async function wrapMON(amount, contract) {
  try {
    console.log(
      `🔄 Wrap ${ethers.utils.formatEther(amount)} MON → WMON...`.magenta
    );
    const tx = await contract.deposit({ value: amount, gasLimit: 500000 });
    console.log(`✔️ Wrap MON → WMON successful`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error occurred:".red, error);
    return false;
  }
}

async function unwrapMON(amount, contract) {
  try {
    console.log(
      `🔄 Unwrap ${ethers.utils.formatEther(amount)} WMON → MON...`
        .magenta
    );
    const tx = await contract.withdraw(amount, { gasLimit: 500000 });
    console.log(`✔️ Unwrap WMON → MON successful`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error occurred:".red, error);
    return false;
  }
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function performSwapCycle(wallet, contract, cycleNumber, totalCycles) {
  try {
    console.log(`Cycle ${cycleNumber} / ${totalCycles}:`.magenta);
    let randomAmount;
    
    try {
      randomAmount = await getRandomAmount(wallet);
    } catch (error) {
      console.error(`❌ Error calculating amount: ${error.message}`.red);
      randomAmount = ethers.utils.parseEther(config.defaultTransactionAmount);
      console.log(`⚠️ Using default amount: ${config.defaultTransactionAmount} MON`.yellow);
    }
    
    const wrapSuccess = await wrapMON(randomAmount, contract);
    if (!wrapSuccess) return false;
    
    const unwrapSuccess = await unwrapMON(randomAmount, contract);
    if (!unwrapSuccess) return false;
    
    return true;
  } catch (error) {
    console.error(`❌ Error occurred: ${error.message}`.red);
    return false;
  }
}

async function runSwapCyclesForAccount(privateKey, cycles) {
  try {
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
    const wallet = new ethers.Wallet(privateKey, provider);
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        "function deposit() public payable",
        "function withdraw(uint256 amount) public",
      ],
      wallet
    );

    const address = wallet.address;
    const truncatedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    console.log(`\n👤 Processing account: ${truncatedAddress}`.cyan);
    
    const balance = await wallet.getBalance();
    console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} MON`.cyan);

    let completedCycles = 0;
    for (let i = 0; i < cycles; i++) {
      const success = await performSwapCycle(wallet, contract, i + 1, cycles);
      if (success) {
        completedCycles++;
      } else {
        console.log(`⚠️ Cycle ${i + 1} failed, moving to next cycle`.yellow);
      }
    }
    
    console.log(`✅ Completed ${completedCycles}/${cycles} cycles for account ${truncatedAddress}`.green);
    return true;
  } catch (error) {
    console.error(`❌ Error processing account, check if private key is correct ${privateKey.substring(0, 6)}...: ${error.message}`.red);
    return false;
  }
}

async function processAllAccounts(cycles, interval) {
  try {
    const privateKeys = readPrivateKeys();
    console.log(`📋 Found ${privateKeys.length} accounts in wallet.txt`.cyan);
    
    for (let i = 0; i < privateKeys.length; i++) {
      console.log(`\n🔄 Processing account ${i + 1} of ${privateKeys.length}`.cyan);
      const success = await runSwapCyclesForAccount(privateKeys[i], cycles);
      
      if (!success) {
        console.log(`⚠️ Could not process account ${i + 1}, moving to next account`.yellow);
      }
      
      if (i < privateKeys.length - 1) {
        console.log(`⏱️ Waiting 3 seconds before moving to next account...`.cyan);
        await delay(ACCOUNT_SWITCH_DELAY);
      }
    }
    
    if (interval) {
      console.log(`\n⏱️ All accounts processed. Next run will start in ${interval} hours`.cyan);
      setTimeout(() => processAllAccounts(cycles, interval), interval * 60 * 60 * 1000);
    } else {
      console.log(`\n✅ All accounts processed successfully`.green.bold);
    }
  } catch (error) {
    console.error(`❌ Error occurred: ${error.message}`.red);
  }
}

function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "How many cycles do you want to perform for each account? (Press Enter for default 1): ",
    (cycles) => {
      rl.question(
        "How often do you want each cycle to run (in hours)? (Press Enter to run immediately): ",
        (hours) => {
          let cyclesCount = cycles ? parseInt(cycles) : 1;
          let intervalHours = hours ? parseInt(hours) : null;

          if (
            isNaN(cyclesCount) ||
            (intervalHours !== null && isNaN(intervalHours))
          ) {
            console.log("❌ Please enter a valid number.".red);
            rl.close();
            return;
          }
          
          processAllAccounts(cyclesCount, intervalHours);
          rl.close();
        }
      );
    }
  );
}

async function runAutomated(cycles = 1, intervalHours = null) {
  await processAllAccounts(cycles, intervalHours);
  return true;
}

module.exports = { 
  run, 
  runAutomated 
};

if (require.main === module) {
  run();
}