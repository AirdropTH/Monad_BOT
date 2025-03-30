const ethers = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');

const CHAIN_CONFIG = {
  RPC_URL: "https://testnet-rpc.monad.xyz",
  CHAIN_ID: 10143,
  SYMBOL: "MON",
  TX_EXPLORER: "https://testnet.monadexplorer.com/tx/",
  ADDRESS_EXPLORER: "https://testnet.monadexplorer.com/address/",
  WMON_ADDRESS: "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701"
};

const KINTSU_CONTRACT = {
  SMON_STAKE_CONTRACT: "0x07AabD925866E8353407E67C1D157836f7Ad923e",
  KINTSU_ABI: [
    {
      name: "stake",
      type: "function",
      stateMutability: "payable",
      inputs: [],  
      outputs: []
    },
    {
      name: "balanceOf",
      type: "function",
      stateMutability: "view",
      inputs: [
        {
          name: "account",
          type: "address"
        }
      ],
      outputs: [
        {
          type: "uint256"
        }
      ]
    },
    {
      name: "symbol",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          type: "string"
        }
      ]
    },
    {
      name: "name",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          type: "string"
        }
      ]
    },
    {
      name: "decreaseStake",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "tokenId",
          type: "uint256"
        },
        {
          name: "stakeAmount",
          type: "uint256"
        }
      ],
      outputs: []
    },
    {
      name: "increaseStake",
      type: "function",
      stateMutability: "nonpayable",
      inputs: [
        {
          name: "tokenId",
          type: "uint256"
        },
        {
          name: "stakeAmount",
          type: "uint256"
        }
      ],
      outputs: []
    },
    {
      name: "totalStaked",
      type: "function",
      stateMutability: "view",
      inputs: [],
      outputs: [
        {
          type: "uint256"
        }
      ]
    }
  ]
};

const provider = new ethers.providers.JsonRpcProvider(CHAIN_CONFIG.RPC_URL);
const contractAddress = KINTSU_CONTRACT.SMON_STAKE_CONTRACT;
const gasLimitStake = 250000;
const gasLimitUnstake = 400000;

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
    const address = await wallet.getAddress();
    
    const minAmount = ethers.utils.parseEther("0.05");
    const maxAmount = ethers.utils.parseEther("0.1");
    
    const range = maxAmount.sub(minAmount);
    const randomBigNumber = ethers.BigNumber.from(
      ethers.utils.randomBytes(4)
    ).mod(range.add(1));
    
    const randomAmount = minAmount.add(randomBigNumber);
    
    console.log(`Amount of MON to use: ${ethers.utils.formatEther(randomAmount)} ${CHAIN_CONFIG.SYMBOL}`);
    
    return randomAmount;
  } catch (error) {
    console.error("Error calculating the amount of MON needed:".red, error.message);
    console.log(`Using default amount 0.01 ${CHAIN_CONFIG.SYMBOL}`.yellow);
    return ethers.utils.parseEther("0.01");
  }
}

function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 2 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

function getRandomGasLimit() {
  return Math.floor(Math.random() * (250000 - 150000 + 1)) + 150000;
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function stakeMON(wallet, cycleNumber) {
  try {
    console.log(`\n[Cycle ${cycleNumber}] Starting to stake MON...`.magenta);
    
    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);
    
    const contract = new ethers.Contract(contractAddress, KINTSU_CONTRACT.KINTSU_ABI, provider);
    const stakeAmount = await getRandomAmount(wallet);
    
    console.log(
      `Stake amount: ${ethers.utils.formatEther(stakeAmount)} ${CHAIN_CONFIG.SYMBOL}`
    );

    const gasLimit = getRandomGasLimit();
    const feeData = await provider.getFeeData();
    const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
    const maxFeePerGas = baseFee.mul(105).div(100);
    const maxPriorityFeePerGas = maxFeePerGas;

    console.log("🔄 Creating transaction...");
    const txResponse = await contract.connect(wallet).stake({
      value: stakeAmount,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    });
    
    console.log(
      `➡️  Transaction sent: ${CHAIN_CONFIG.TX_EXPLORER}${txResponse.hash}`.yellow
    );

    console.log("🔄 Waiting for confirmation...");
    const receipt = await txResponse.wait();
    console.log(`✔️  Stake successful!`.green.underline);

    const sMonBalance = await contract.balanceOf(walletAddress);
    console.log(
      `⭐ SMON balance: ${parseFloat(ethers.utils.formatEther(sMonBalance)).toFixed(6)}`.magenta
    );

    return { receipt, stakeAmount };
  } catch (error) {
    console.error("❌ Stake failed:".red, error.message);
    throw error;
  }
}

async function unStake(wallet, tokenId, stakeAmount, cycleNumber) {
  try {
    console.log(
      `\n[Cycle ${cycleNumber}] Starting to check for unstake...`.magenta
    );
    
    const walletAddress = await wallet.getAddress();
    console.log(`Wallet: ${walletAddress}`.cyan);
    
    const contract = new ethers.Contract(contractAddress, KINTSU_CONTRACT.KINTSU_ABI, provider);
    
    const sMonBalance = await contract.balanceOf(walletAddress);
    const sMonBalanceEth = parseFloat(ethers.utils.formatEther(sMonBalance));
    console.log(`⭐ SMON balance: ${sMonBalanceEth.toFixed(6)}`.magenta);
    
    if (sMonBalanceEth <= 0.01) {
      console.log(`SMON balance is less than 0.1. Not unstaking.`.yellow);
      return null;
    }
    
    console.log(
      `Unstake amount: 0.1 ${CHAIN_CONFIG.SYMBOL}`
    );

    const gasLimit = getRandomGasLimit();
    const feeData = await provider.getFeeData();
    const baseFee = feeData.maxFeePerGas || feeData.gasPrice;
    const maxFeePerGas = baseFee.mul(105).div(100);
    const maxPriorityFeePerGas = maxFeePerGas;

    console.log("🔄 Creating unstake transaction...");
    
    const unstakeData = "0x30af6b2e000000000000000000000000000000000000000000000000016345785d8a0000";
    const encodedTokenId = ethers.utils.hexZeroPad(ethers.utils.hexlify(tokenId), 32).slice(2);
    const modifiedData = unstakeData.slice(0, 10) + encodedTokenId + unstakeData.slice(74);
    
    const tx = {
      to: contractAddress,
      data: unstakeData,
      gasLimit,
      maxFeePerGas,
      maxPriorityFeePerGas
    };

    const txResponse = await wallet.sendTransaction(tx);
    
    console.log(
      `➡️ Transaction sent ${CHAIN_CONFIG.TX_EXPLORER}${txResponse.hash}`.yellow
    );

    console.log("🔄 Waiting for confirmation...");
    const receipt = await txResponse.wait();
    console.log(`✔️ Unstake successful!`.green.underline);

    const updatedSMonBalance = await contract.balanceOf(walletAddress);
    console.log(
      `⭐ Updated SMON balance: ${parseFloat(ethers.utils.formatEther(updatedSMonBalance)).toFixed(6)}`.magenta
    );

    return receipt;
  } catch (error) {
    console.error("❌ Unstake failed:".red, error.message);
    console.error("Error:", JSON.stringify(error, null, 2));
    throw error;
  }
}

async function runCycle(wallet, cycleNumber, tokenId) {
  try {
    const walletAddress = await wallet.getAddress();
    console.log(`\n=== Starting cycle ${cycleNumber} for wallet ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.magenta.bold);

    const { stakeAmount } = await stakeMON(wallet, cycleNumber);

    const delayTime = getRandomDelay();
    console.log(`Waiting ${delayTime / 1000} seconds before checking unstake...`);
    await delay(delayTime);

    const unstakeResult = await unStake(wallet, tokenId || 1, stakeAmount, cycleNumber);
    
    if (unstakeResult === null) {
      console.log(`Skipped unstake due to sMON balance lower than 0.1`.yellow);
    }

    console.log(
      `=== Cycle ${cycleNumber} of wallet ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} completed! ===`.magenta.bold
    );
    return true;
  } catch (error) {
    console.error(`❌ Cycle ${cycleNumber} encountered an error:`.red, error.message);
    return false;
  }
}

async function processWallet(privateKey, cycleCount, walletIndex, totalWallets, tokenId) {
  try {
    const wallet = new ethers.Wallet(privateKey, provider);
    const walletAddress = await wallet.getAddress();
    
    console.log(`\n=== Processing wallet ${walletIndex + 1}/${totalWallets}: ${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)} ===`.cyan.bold);
    
    for (let i = 1; i <= cycleCount; i++) {
      const success = await runCycle(wallet, i, tokenId);
      
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
    
    rl.question("How many cycles do you want to run for each wallet? ", (answer) => {
      const cycleCount = parseInt(answer);
      if (isNaN(cycleCount) || cycleCount <= 0) {
        console.error("Please enter a valid number!".red);
        rl.close();
        process.exit(1);
      }
      rl.close();
      resolve(cycleCount);
    });
  });
}

function getTokenId() {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    
    rl.question("Enter token ID to unstake (default: 1): ", (answer) => {
      const tokenId = parseInt(answer) || 1;
      rl.close();
      resolve(tokenId);
    });
  });
}

async function run() {
  try {
    console.log("Starting Kintsu...".green);
    console.log("Reading wallets from wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Found ${privateKeys.length} wallets in wallet.txt`.green);
    
    const cycleCount = await getCycleCount();
    const tokenId = await getTokenId();
    console.log(`Starting ${cycleCount} cycles on each wallet with token ID ${tokenId}...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycleCount, i, privateKeys.length, tokenId);
      
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

async function runAutomated(cycles = 1, tokenId = 1, intervalHours = null) {
  try {
    console.log("[Automated] Starting Kintsu...".green);
    console.log("Reading wallets from wallet.txt...".yellow);
    
    const privateKeys = readPrivateKeys();
    console.log(`Found ${privateKeys.length} wallets in wallet.txt`.green);
    console.log(`[Automated] Starting ${cycles} cycles on each wallet with token ID ${tokenId}...`.yellow);
    
    for (let i = 0; i < privateKeys.length; i++) {
      await processWallet(privateKeys[i], cycles, i, privateKeys.length, tokenId);
      
      if (i < privateKeys.length - 1) {
        console.log(`\nSwitching to the next wallet after 3 seconds...`.yellow);
        await delay(3000);
      }
    }
    
    console.log(`\n[Automated] All wallets processed successfully!`.green.bold);
    
    if (intervalHours) {
      const intervalMs = intervalHours * 60 * 60 * 1000;
      console.log(`\n⏱️ Next run scheduled in ${intervalHours} hours`.cyan);
      setTimeout(() => runAutomated(cycles, tokenId, intervalHours), intervalMs);
    }
    
    return true;
  } catch (error) {
    console.error("[Automated] Operation failed:".red, error.message);
    return false;
  }
}

let configCycles = 1;
let configTokenId = 1;

function setCycles(cycles) {
  if (cycles && !isNaN(cycles) && cycles > 0) {
    configCycles = cycles;
    console.log(`[Config] Set cycles to ${cycles}`.yellow);
  }
}

function setTokenId(tokenId) {
  if (tokenId && !isNaN(tokenId) && tokenId > 0) {
    configTokenId = tokenId;
    console.log(`[Config] Set token ID to ${tokenId}`.yellow);
  }
}

module.exports = {
  run,
  runAutomated,
  setCycles,
  setTokenId,
  stakeMON,
  unStake,
  getRandomAmount,
  getRandomDelay,
};

if (require.main === module) {
  run();
}