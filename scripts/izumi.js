const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";

const provider = new ethers.providers.JsonRpcProvider(RPC_URL);

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
    
    console.log(`Found ${privateKeys.length} wallets in wallet.txt`.green);
    return privateKeys;
  } catch (error) {
    console.error("Could not read file wallet.txt:".red, error.message);
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
      console.error("Insufficient balance to swap".red);
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

async function wrapMON(wallet, amount, cycleNumber) {
  try {
    const address = await wallet.getAddress();
    const formattedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    
    console.log(
      `[Wallet ${formattedAddress}][Cycle ${cycleNumber}] 🔄 Wrap ${ethers.utils.formatEther(amount)} MON → WMON...`.magenta
    );
    
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        "function deposit() public payable",
        "function withdraw(uint256 amount) public",
      ],
      wallet
    );
    
    const tx = await contract.deposit({ value: amount, gasLimit: 500000 });
    console.log(`✔️  Wrap MON → WMON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error wrapping MON:".red, error.message);
    return false;
  }
}

async function unwrapMON(wallet, amount, cycleNumber) {
  try {
    const address = await wallet.getAddress();
    const formattedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    
    console.log(
      `[Wallet ${formattedAddress}][Cycle ${cycleNumber}] 🔄 Unwrap ${ethers.utils.formatEther(amount)} WMON → MON...`.magenta
    );
    
    const contract = new ethers.Contract(
      WMON_CONTRACT,
      [
        "function deposit() public payable",
        "function withdraw(uint256 amount) public",
      ],
      wallet
    );
    
    const tx = await contract.withdraw(amount, { gasLimit: 500000 });
    console.log(`✔️  Unwrap WMON → MON successful`.green.underline);
    console.log(`➡️  Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error unwrapping WMON:".red, error.message);
    return false;
  }
}

async function processWallet(privateKey, cycles, walletIndex, totalWallets) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const address = await wallet.getAddress();
    const formattedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    
    console.log(`\n=== Processing wallet ${walletIndex + 1}/${totalWallets}: ${formattedAddress} ===`.cyan.bold);
    
    for (let i = 1; i <= cycles; i++) {
      console.log(`\n[Wallet ${formattedAddress}] Starting cycle ${i} / ${cycles}:`.magenta);
      
      try {
        const randomAmount = await getRandomAmount(wallet);
        console.log(`Random amount: ${ethers.utils.formatEther(randomAmount)} MON (1-5% balance)`);
        
        const wrapSuccess = await wrapMON(wallet, randomAmount, i);
        if (!wrapSuccess) {
          console.log(`[Wallet ${formattedAddress}] skipping cycle ${i} due to wrap error`.yellow);
          continue;
        }
        
        const unwrapSuccess = await unwrapMON(wallet, randomAmount, i);
        if (!unwrapSuccess) {
          console.log(`[Wallet ${formattedAddress}] cycle ${i} incomplete due to unwrap error`.yellow);
          continue;
        }
        
        console.log(`[Wallet ${formattedAddress}] cycle ${i} completed`.green);
        
        if (i < cycles) {
          const randomDelay = getRandomDelay();
          console.log(
            `[Wallet ${formattedAddress}] waiting ${randomDelay / 1000 / 60} minutes for the next cycle...`.yellow
          );
          await delay(randomDelay);
        }
      } catch (error) {
        console.error(`[Wallet ${formattedAddress}] Error in cycle ${i}:`.red, error.message);
        continue;
      }
    }
    
    console.log(`\n=== Completed all cycles for wallet ${formattedAddress} ===`.cyan.bold);
    return true;
  } catch (error) {
    console.error(`Error processing wallet ${walletIndex + 1}:`.red, error.message);
    return false;
  }
}

async function runSwapCycles(cycles) {
  try {
    console.log("Starting wrap/unwrap WMON...".green);
    
    const privateKeys = readPrivateKeys();
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycles, i, privateKeys.length);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nMoving to the next wallet after 3 seconds...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(`\nAll wallets processed successfully!`.green.bold);
    return true;
  } catch (error) {
    console.error("Operation failed:".red, error.message);
    return false;
  }
}

async function run() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question(
    "How many cycles do you want to run on each wallet? ",
    (cycles) => {
      let cyclesCount = cycles ? parseInt(cycles) : 1;
      
      if (isNaN(cyclesCount) || cyclesCount <= 0) {
        console.log("❌ Please enter a valid number.".red);
        rl.close();
        return;
      }
      runSwapCycles(cyclesCount);
      
      rl.close();
    }
  );
}

async function runAutomated(cycles = 1, intervalHours = null) {
  try {
    console.log("[Automated] Starting wrap/unwrap WMON...".green);
    console.log(`[Automated] Running ${cycles} cycles on each wallet`.yellow);
    
    const result = await runSwapCycles(cycles);
    
    if (result && intervalHours) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      console.log(`\n⏱️ Next run scheduled in ${intervalHours} hours`.cyan);
      setTimeout(() => runAutomated(cycles, intervalHours), intervalMs);
    }
    
    return result;
  } catch (error) {
    console.error("[Automated] Operation failed:".red, error.message);
    return false;
  }
}

module.exports = {
  run,
  runAutomated,
  wrapMON,
  unwrapMON,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}