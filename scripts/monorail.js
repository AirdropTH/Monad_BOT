const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const axios = require("axios");
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

const MAX_RETRIES = 3;
const RETRY_DELAY = 5000; // 5 seconds

const ROUTER_CONTRACT = "0xC995498c22a012353FAE7eCC701810D673E25794";
const WMON_CONTRACT = "0x760afe86e5de5fa0ee542fc7b7b713e1c5425701";
const USDC_CONTRACT = "0xf817257fed379853cde0fa4f97ab987181b1e5ea";
const WETH_CONTRACT = "0xb5a30b0fdc5ea94a52fdc42e3e9760cb8449fb37";

const availableTokens = {
  MON: { name: "MON", address: null, decimals: 18, native: true },
  WMON: { name: "WMON", address: WMON_CONTRACT, decimals: 18, native: false },
  USDC: { name: "USDC", address: USDC_CONTRACT, decimals: 6, native: false },
  WETH: { name: "WETH", address: WETH_CONTRACT, decimals: 18, native: false },
};

const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] memory path) public view returns (uint[] memory amounts)",
  "function swapExactETHForTokens(uint amountOutMin, address[] calldata path, address to, uint deadline) external payable returns (uint[] memory amounts)",
  "function swapExactTokensForETH(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)",
  "function swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] calldata path, address to, uint deadline) external returns (uint[] memory amounts)"
];

const ERC20_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function transfer(address to, uint amount) returns (bool)"
];

const WMON_ABI = [
  "function deposit() public payable",
  "function withdraw(uint256 amount) public",
  "function balanceOf(address owner) view returns (uint256)"
];

async function withRetry(operation, operationName) {
  let lastError;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      
      const isServerError = 
        error.code === 'SERVER_ERROR' || 
        (error.response && error.response.status >= 500) ||
        error.message.includes('503') ||
        error.message.includes('SERVER_ERROR');
      
      if (!isServerError && !error.message.includes('bad response')) {
        throw error;
      }
      
      if (attempt < MAX_RETRIES) {
        console.log(`⚠️ ${operationName} failed with server error (attempt ${attempt}/${MAX_RETRIES}), retrying in ${RETRY_DELAY/1000} seconds...`.yellow);
        await delay(RETRY_DELAY);
      } else {
        console.log(`❌ ${operationName} failed after ${MAX_RETRIES} attempts: ${error.message}`.red);
      }
    }
  }
  
  throw lastError;
}

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

async function getRandomAmount(wallet, token, isToMON = false) {
  return await withRetry(async () => {
    let balance;
    if (token.native) {
      balance = await wallet.getBalance();
    } else {
      const tokenContract = new ethers.Contract(token.address, ERC20_ABI, wallet);
      balance = await tokenContract.balanceOf(wallet.address);
    }
    
    if (isToMON) {
      return balance.mul(99).div(100);
    }
    
    const minPercentage = config.transactionLimits.minPercentage;
    const maxPercentage = config.transactionLimits.maxPercentage;
    
    const min = balance.mul(minPercentage * 10).div(1000); // minPercentage% of balance
    const max = balance.mul(maxPercentage * 10).div(1000); // maxPercentage% of balance
    
    const minAmount = ethers.utils.parseUnits("0.0001", token.decimals);
    if (min.lt(minAmount)) {
      console.log("⚠️ Balance too low, using minimum amount".yellow);
      return minAmount;
    }
    
    const range = max.sub(min);
    const randomValue = ethers.BigNumber.from(
      ethers.utils.randomBytes(32)
    ).mod(range);
    const amount = min.add(randomValue);
    
    return amount;
  }, `Calculating random amount for ${token.name}`);
}

function getRandomDelay() {
  const minDelay = 30 * 1000;
  const maxDelay = 1 * 60 * 1000;
  return Math.floor(Math.random() * (maxDelay - minDelay + 1) + minDelay);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function getTokenBalance(wallet, token) {
  let retries = 0;
  const maxRetries = 3;
  const retryDelay = 5000;
  
  while (retries < maxRetries) {
    try {
      if (token.native) {
        const balance = await wallet.provider.getBalance(wallet.address);
        return {
          raw: balance,
          formatted: ethers.utils.formatUnits(balance, token.decimals)
        };
      } else {
        const tokenContract = new ethers.Contract(token.address, ERC20_ABI, wallet);
        const balance = await tokenContract.balanceOf(wallet.address);
        return {
          raw: balance,
          formatted: ethers.utils.formatUnits(balance, token.decimals)
        };
      }
    } catch (error) {
      retries++;
      console.log(`⚠️ Error getting ${token.name} token balance (attempt ${retries}/${maxRetries})`.yellow);
      
      if (retries < maxRetries) {
        console.log(`⏱️ Waiting ${retryDelay / 1000} seconds before retrying...`.cyan);
        await delay(retryDelay);
      } else {
        console.log(`❌ Could not get ${token.name} token balance after ${maxRetries} attempts`.red);
        throw error;
      }
    }
  }
}

async function approveTokenIfNeeded(wallet, token, amount, routerAddress) {
  if (token.native) return true;
  
  return await withRetry(async () => {
    const tokenContract = new ethers.Contract(token.address, ERC20_ABI, wallet);
    const allowance = await tokenContract.allowance(wallet.address, routerAddress);
    
    if (allowance.lt(amount)) {
      console.log(`⚙️ Approving token ${token.name}...`.cyan);
      const tx = await tokenContract.approve(routerAddress, ethers.constants.MaxUint256);
      console.log(`🚀 Approve Tx Sent! ${EXPLORER_URL}${tx.hash}`.yellow);
      await tx.wait();
      console.log(`✅ Token ${token.name} has been approved`.green);
    } else {
      console.log(`✅ Token ${token.name} was already approved`.green);
    }
    return true;
  }, `Approving ${token.name}`);
}

async function wrapMON(amount, wallet) {
  return await withRetry(async () => {
    console.log(`🔄 Wrap ${ethers.utils.formatEther(amount)} MON → WMON...`.magenta);
    const wmonContract = new ethers.Contract(WMON_CONTRACT, WMON_ABI, wallet);
    const tx = await wmonContract.deposit({ value: amount, gasLimit: 500000 });
    console.log(`✔️ Wrap MON → WMON successful`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  }, "Wrapping MON");
}

async function unwrapMON(amount, wallet) {
  return await withRetry(async () => {
    console.log(`🔄 Unwrap ${ethers.utils.formatEther(amount)} WMON → MON...`.magenta);
    const wmonContract = new ethers.Contract(WMON_CONTRACT, WMON_ABI, wallet);
    const tx = await wmonContract.withdraw(amount, { gasLimit: 500000 });
    console.log(`✔️ Unwrap WMON → MON successful`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  }, "Unwrapping WMON");
}

async function getPathfinderQuote(wallet, tokenFrom, tokenTo, amount) {
  return await withRetry(async () => {
    const fromAddress = tokenFrom.native ? "0x0000000000000000000000000000000000000000" : tokenFrom.address;
    const amountFormatted = ethers.utils.formatUnits(amount, tokenFrom.decimals);
    
    const url = `https://testnet-pathfinder.monorail.xyz/v1/router/quote?amount=${amountFormatted}&from=${fromAddress}&to=${tokenTo.address}&slippage=100&deadline=60&source=fe&sender=${wallet.address}`;
    
    console.log(`🔍 Preparing to create transaction...`.cyan);
    const response = await axios.get(url);
    
    if (!response.data || !response.data.quote || !response.data.quote.transaction) {
      console.error(`❌ API response doesn't contain necessary transaction data`.red);
      console.error(JSON.stringify(response.data, null, 2));
      return null;
    }
    
    return response.data.quote.transaction;
  }, "Getting Pathfinder quote");
}

async function swapTokens(wallet, tokenA, tokenB, amountIn, isToMON = false) {
  try {
    if (tokenA.native && tokenB.name === "WMON") {
      return await wrapMON(amountIn, wallet);
    }
    
    if (tokenA.name === "WMON" && tokenB.native) {
      return await unwrapMON(amountIn, wallet);
    }
    
    if (!tokenA.native) {
      const approveSuccess = await approveTokenIfNeeded(wallet, tokenA, amountIn, ROUTER_CONTRACT);
      if (!approveSuccess) {
        console.log(`❌ Could not approve token ${tokenA.name}. Skipping this transaction.`.red);
        return false;
      }
    }
    
    const formattedAmountIn = ethers.utils.formatUnits(amountIn, tokenA.decimals);
    console.log(`🔄 Preparing to swap ${formattedAmountIn} ${tokenA.name} → ${tokenB.name}`.magenta);
    
    const txData = await getPathfinderQuote(wallet, tokenA, tokenB, amountIn);
    if (!txData) {
      console.log(`❌ Could not get transaction data from API. Trying another token pair.`.red);
      return false;
    }
    
    return await withRetry(async () => {
      const feeData = await wallet.provider.getFeeData();
      const txOverrides = {
        gasLimit: 500000,
        maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice,
        maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || feeData.gasPrice
      };
      
      if (tokenA.native) {
        txOverrides.value = amountIn;
      }
      
      console.log(`🚀 Sending transaction to ${txData.to}...`.yellow);
      const tx = await wallet.sendTransaction({
        to: txData.to,
        data: txData.data,
        value: tokenA.native ? txData.value : "0",
        ...txOverrides
      });
      
      console.log(`🚀 Swap Tx Sent! ${EXPLORER_URL}${tx.hash}`.yellow);
      const receipt = await tx.wait();
      console.log(`✅ Swap ${tokenA.name} → ${tokenB.name} successful (Block ${receipt.blockNumber})`.green.underline);
      return true;
    }, `Executing swap ${tokenA.name} → ${tokenB.name}`);
  } catch (error) {
    console.error(`❌ Error swapping ${tokenA.name} → ${tokenB.name}:`.red);
    return false;
  }
}

async function swapMonToToken(wallet, token) {
  try {
    console.log(`⚠️ ${token.name} balance too low to perform transaction`.yellow);
    console.log(`🔄 Swapping MON to ${token.name} to continue transaction...`.cyan);
    
    const monBalance = await getTokenBalance(wallet, availableTokens.MON);
    if (monBalance.raw.isZero() || monBalance.raw.lt(ethers.utils.parseUnits("0.001", 18))) {
      console.log(`❌ MON balance too low to perform swap`.red);
      return false;
    }
    
    const randomAmount = await getRandomAmount(wallet, availableTokens.MON);
    const swapSuccess = await swapTokens(wallet, availableTokens.MON, token, randomAmount);
    
    if (swapSuccess) {
      const newBalance = await getTokenBalance(wallet, token);
      console.log(`✅ Swapped MON to ${token.name}. New balance: ${newBalance.formatted} ${token.name}`.green);
      return true;
    } else {
      console.log(`❌ Could not swap MON to ${token.name}`.red);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error swapping MON to ${token.name}: ${error.message}`.red);
    return false;
  }
}

async function getRandomTokenPair() {
  const tokenKeys = Object.keys(availableTokens);
  const tokenAIndex = Math.floor(Math.random() * tokenKeys.length);
  let tokenBIndex;
  
  do {
    tokenBIndex = Math.floor(Math.random() * tokenKeys.length);
  } while (tokenBIndex === tokenAIndex);
  
  return [availableTokens[tokenKeys[tokenAIndex]], availableTokens[tokenKeys[tokenBIndex]]];
}

async function performSwapCycle(wallet, cycleNumber, totalCycles) {
  try {
    console.log(`Cycle ${cycleNumber} / ${totalCycles}:`.magenta);
    
    const [tokenA, tokenB] = await getRandomTokenPair();
    console.log(`🔀 Selected trading pair: ${tokenA.name} → ${tokenB.name}`.cyan);
    
    const balanceA = await getTokenBalance(wallet, tokenA);
    console.log(`💰 ${tokenA.name} balance: ${balanceA.formatted}`.cyan);
    
    let continueWithTokenA = true;
    if (balanceA.raw.isZero() || balanceA.raw.lt(ethers.utils.parseUnits("0.0001", tokenA.decimals))) {
      if (!tokenA.native) {
        continueWithTokenA = await swapMonToToken(wallet, tokenA);
      } else {
        console.log(`⚠️ MON balance too low to perform transaction`.yellow);
        continueWithTokenA = false;
      }
      
      if (!continueWithTokenA) {
        console.log(`❌ Cannot continue with token ${tokenA.name}, trying another pair`.yellow);
        return await retryWithDifferentPair(wallet, tokenA);
      }
    }
    
    const isToNative = tokenB.native;
    const randomAmount = await getRandomAmount(wallet, tokenA, isToNative);
    
    const swapSuccess = await swapTokens(wallet, tokenA, tokenB, randomAmount, isToNative);
    if (!swapSuccess) {
      console.log(`❌ Swap ${tokenA.name} → ${tokenB.name} failed, trying another pair`.yellow);
      return await retryWithDifferentPair(wallet, tokenA);
    }
    
    const randomDelay = getRandomDelay();
    console.log(`⏱️ Waiting ${Math.floor(randomDelay / 1000)} seconds...`.cyan);
    await delay(randomDelay);
    
    const balanceB = await getTokenBalance(wallet, tokenB);
    console.log(`💰 ${tokenB.name} balance: ${balanceB.formatted}`.cyan);
    
    let continueWithTokenB = true;
    if (balanceB.raw.isZero() || balanceB.raw.lt(ethers.utils.parseUnits("0.0001", tokenB.decimals))) {
      if (!tokenB.native) {
        continueWithTokenB = await swapMonToToken(wallet, tokenB);
      } else {
        console.log(`⚠️ MON balance too low to perform reverse transaction`.yellow);
        continueWithTokenB = false;
      }
      
      if (!continueWithTokenB) {
        console.log(`⚠️ Cannot perform reverse swap, but initial transaction succeeded`.yellow);
        return true;
      }
    }
    
    const isReversalToNative = tokenA.native;
    const reverseAmount = await getRandomAmount(wallet, tokenB, isReversalToNative);
    const reverseSwapSuccess = await swapTokens(wallet, tokenB, tokenA, reverseAmount, isReversalToNative);
    
    if (!reverseSwapSuccess) {
      console.log(`⚠️ Reverse swap ${tokenB.name} → ${tokenA.name} failed`.yellow);
      return true;
    }
    
    return true;
  } catch (error) {
    console.error(`❌ Swap cycle error: ${error.message}`.red);
    return false;
  }
}

async function retryWithDifferentPair(wallet, excludeToken) {
  try {
    console.log(`🔄 Retrying with a different token pair...`.cyan);
    
    const validTokens = Object.values(availableTokens).filter(token => token.name !== excludeToken.name);
    if (validTokens.length < 2) {
      console.log(`⚠️ Not enough valid tokens to retry`.yellow);
      return false;
    }
    
    const tokenAIndex = Math.floor(Math.random() * validTokens.length);
    const tokenA = validTokens[tokenAIndex];
    
    let tokenBIndex;
    do {
      tokenBIndex = Math.floor(Math.random() * validTokens.length);
    } while (tokenBIndex === tokenAIndex);
    const tokenB = validTokens[tokenBIndex];
    
    console.log(`🔀 Retrying with pair: ${tokenA.name} → ${tokenB.name}`.cyan);
    
    const balanceA = await getTokenBalance(wallet, tokenA);
    console.log(`💰 ${tokenA.name} balance: ${balanceA.formatted}`.cyan);
    
    let continueWithTokenA = true;
    if (balanceA.raw.isZero() || balanceA.raw.lt(ethers.utils.parseUnits("0.0001", tokenA.decimals))) {
      if (!tokenA.native) {
        continueWithTokenA = await swapMonToToken(wallet, tokenA);
      } else {
        console.log(`⚠️ MON balance too low to perform transaction`.yellow);
        continueWithTokenA = false;
      }
      
      if (!continueWithTokenA) {
        console.log(`❌ Cannot continue with token ${tokenA.name}`.yellow);
        return false;
      }
    }
    
    const isToNative = tokenB.native;
    const randomAmount = await getRandomAmount(wallet, tokenA, isToNative);
    
    return await swapTokens(wallet, tokenA, tokenB, randomAmount, isToNative);
  } catch (error) {
    console.error(`❌ Error during retry: ${error.message}`.red);
    return false;
  }
}

async function runSwapCyclesForAccount(privateKey, cycles) {
  try {
    if (!privateKey.startsWith('0x')) {
      privateKey = '0x' + privateKey;
    }
    
    let provider = null;
    await withRetry(async () => {
      provider = new ethers.providers.JsonRpcProvider(RPC_URL);
      await provider.getNetwork();
    }, "Connecting to RPC provider");
    
    const wallet = new ethers.Wallet(privateKey, provider);

    const address = wallet.address;
    const truncatedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    console.log(`\n👤 Processing account: ${truncatedAddress}`.cyan);
    
    const balance = await withRetry(() => wallet.getBalance(), "Getting account balance");
    console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} MON`.cyan);

    let completedCycles = 0;
    for (let i = 0; i < cycles; i++) {
      const success = await performSwapCycle(wallet, i + 1, cycles);
      if (success) {
        completedCycles++;
      } else {
        console.log(`⚠️ Cycle ${i + 1} failed, moving to next cycle`.yellow);
      }
      
      if (i < cycles - 1) {
        const cycleDelay = getRandomDelay() * 2;
        console.log(`⏱️ Waiting ${Math.floor(cycleDelay / 1000)} seconds before next cycle...`.cyan);
        await delay(cycleDelay);
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
        console.log(`⏱️ Waiting 3 seconds before next account...`.cyan);
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