const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const provider = new ethers.providers.JsonRpcProvider(RPC_URL);
const contractAddress = "0x2c9C959516e9AAEdB2C748224a41249202ca8BE7";
const gasLimitStake = 500000;
const gasLimitUnstake = 800000;

function readPrivateKeys() {
  try {
    const fileContent = fs.readFileSync("wallet.txt", "utf8");
    const privateKeys = fileContent
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line.length > 0);
    
    if (privateKeys.length === 0) {
      console.error("No private keys found in wallet.txt".red);
      process.exit(1);
    }
    
    return privateKeys;
  } catch (error) {
    console.error("Unable to read wallet.txt file:".red, error.message);
    process.exit(1);
  }
}

async function getRandomAmount(wallet) {
  try {
    const balance = await wallet.getBalance();
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    
    const minAmount = balance.mul(minPercentage * 10).div(1000); // minPercentage% of balance
    const maxAmount = balance.mul(maxPercentage * 10).div(1000); // maxPercentage% of balance
    
    if (minAmount.eq(0) || balance.lt(minAmount)) {
      console.error("Insufficient balance to stake".red);
      throw new Error("Insufficient balance");
    }
    
    const range = maxAmount.sub(minAmount);
    const randomBigNumber = ethers.BigNumber.from(
      ethers.utils.randomBytes(4)
    ).mod(range.add(1));
    
    const randomAmount = minAmount.add(randomBigNumber);
    
    return randomAmount;
  } catch (error) {
    console.error("Error calculating random amount:".red, error.message);
    throw error;
  }
}

function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 1 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stakeMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Starting to stake MON...`.magenta);
    
    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);
    
    const stakeAmount = await getRandomAmount(wallet);
    console.log(
      `Random stake amount: ${ethers.utils.formatEther(stakeAmount)} MON (1-5% balance)`
    );

    const tx = {
      to: contractAddress,
      data: "0xd5575982",
      gasLimit: ethers.utils.hexlify(gasLimitStake),
      value: stakeAmount,
    };

    console.log("🔄 Starting to create transaction...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent: ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Waiting for transaction confirmation...");
    const receipt = await txResponse.wait();
    console.log(`✔️  Stake successful!`.green.underline);

    return { receipt, stakeAmount };
  } catch (error) {
    console.error("❌ Stake failed:".red, error.message);
    throw error;
  }
}

async function unstakeGMON(wallet, amountToUnstake, cycleNumber) {
  try {
    console.log(
      `\n[Cycle ${cycleNumber}] Starting to unstake gMON...`.magenta
    );
    
    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);
    
    console.log(
      `Unstake amount: ${ethers.utils.formatEther(amountToUnstake)} gMON`
    );

    const functionSelector = "0x6fed1ea7";
    const paddedAmount = ethers.utils.hexZeroPad(
      amountToUnstake.toHexString(),
      32
    );
    const data = functionSelector + paddedAmount.slice(2);

    const tx = {
      to: contractAddress,
      data: data,
      gasLimit: ethers.utils.hexlify(gasLimitUnstake),
    };

    console.log("🔄 Starting to create transaction...");
    const txResponse = await wallet.sendTransaction(tx);
    console.log(
      `➡️  Transaction sent ${EXPLORER_URL}${txResponse.hash}`.yellow
    );

    console.log("🔄 Waiting for transaction confirmation...");
    const receipt = await txResponse.wait();
    console.log(`✔️  Unstake successful!`.green.underline);

    return receipt;
  } catch (error) {
    console.error("❌ Unstake failed:".red, error.message);
    console.error("Full error:", JSON.stringify(error, null, 2));
    throw error;
  }
}

async function runCycle(wallet, cycleNumber) {
  try {
    const walletAddress = await wallet.getAddress();
    console.log(`\n=== Starting cycle ${cycleNumber} for wallet ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.magenta.bold);

    const { stakeAmount } = await stakeMON(wallet, cycleNumber);

    const delayTime = getRandomDelay();
    console.log(`Waiting ${delayTime / 1000} seconds to start unstake...`);
    await delay(delayTime);

    await unstakeGMON(wallet, stakeAmount, cycleNumber);

    console.log(
      `=== Cycle ${cycleNumber} for wallet ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} completed! ===`.magenta.bold
    );
    return true;
  } catch (error) {
    console.error(`❌ Cycle ${cycleNumber} encountered an error:`.red, error.message);
    return false;
  }
}

async function processWallet(privateKey, cycleCount, walletIndex, totalWallets) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();
    
    console.log(`\n=== Processing wallet ${walletIndex + 1}/${totalWallets}: ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.cyan.bold);
    
    for (let i = 1; i <= cycleCount; i++) {
      const success = await runCycle(wallet, i);
      
      if (!success) {
        console.log(`Skipping remaining cycles for this wallet due to error`.yellow);
        break;
      }
      
      if (i < cycleCount) {
        const interCycleDelay = getRandomDelay();
        console.log(
          `\nWaiting ${interCycleDelay / 1000} seconds for the next cycle...`
        );
        await delay(interCycleDelay);
      }
    }
    
    console.log(`\n=== Completed all cycles for wallet ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.cyan.bold);
    
  } catch (error) {
    console.error(`Error processing wallet ${walletIndex + 1}:`.red, error.message);
  }
}

function getCycleCount() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question("How many stake cycles do you want to run for each wallet? ", (answer) => {
      const cycleCount = parseInt(answer);
      if (isNaN(cycleCount) || cycleCount <= 0) {
        console.error("Please enter a number!".red);
        rl.close();
        process.exit(1);
      }
      rl.close();
      resolve(cycleCount);
    });
  });
}

async function run() {
  try {
    console.log("Starting Magma Stake...".green);
    console.log("Reading wallets from wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Found ${privateKeys.length} wallets from wallet.txt`.green);
    
    const cycleCount = await getCycleCount();
    console.log(`Starting to run ${cycleCount} cycles on each wallet...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycleCount, i, privateKeys.length);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nSwitching to the next wallet after 3 seconds...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(
      `\nAll wallets processed successfully!`.green.bold
    );
  } catch (error) {
    console.error("Operation failed:".red, error.message);
  }
}

async function runAutomated(cycles = 1, intervalHours = null) {
  try {
    console.log("[Automated] Starting Magma Stake...".green);
    console.log("Reading wallets from wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Found ${privateKeys.length} wallets from wallet.txt`.green);
    console.log(`[Automated] Starting to run ${cycles} cycles on each wallet...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycles, i, privateKeys.length);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nSwitching to the next wallet after 3 seconds...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(`\n[Automated] All wallets processed successfully!`.green.bold);
    
    if (intervalHours) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      console.log(`\n⏱️ Next run scheduled after ${intervalHours} hour(s)`.cyan);
      setTimeout(() => runAutomated(cycles, intervalHours), intervalMs);
    }
    
    return true;
  } catch (error) {
    console.error("[Automated] Operation failed:".red, error.message);
    return false;
  }
}

let configCycles = 1;
function setCycles(cycles) {
  if (cycles && !isNaN(cycles) && cycles > 0) {
    configCycles = cycles;
    console.log(`[Config] Set cycles to ${cycles}`.yellow);
  }
}

module.exports = {
  run,
  runAutomated,
  setCycles,
  stakeMON,
  unstakeGMON,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}