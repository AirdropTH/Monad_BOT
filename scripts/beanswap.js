const { ethers } = require("ethers");
const colors = require("colors");
const readline = require("readline");
const fs = require("fs");
const config = require('./config');
const RPC_URL = "https://testnet-rpc.monad.xyz/";
const EXPLORER_URL = "https://testnet.monadexplorer.com/tx/";
const WALLET_FILE = "wallet.txt";
const ACCOUNT_SWITCH_DELAY = 3000;

const ROUTER_CONTRACT = "0xCa810D095e90Daae6e867c19DF6D9A8C56db2c89";
const WMON_CONTRACT = "0x760AfE86e5de5fa0Ee542fc7B7B713e1c5425701";
const USDC_CONTRACT = "0x62534E4bBD6D9ebAC0ac99aeaa0aa48E56372df0";
const BEAN_CONTRACT = "0x268E4E24E0051EC27b3D27A95977E71cE6875a05";
const JAI_CONTRACT = "0x70F893f65E3C1d7f82aad72f71615eb220b74D10";

const availableTokens = {
  MON: { name: "MON", address: null, decimals: 18, native: true },
  WMON: { name: "WMON", address: WMON_CONTRACT, decimals: 18, native: false },
  USDC: { name: "USDC", address: USDC_CONTRACT, decimals: 6, native: false },
  BEAN: { name: "BEAN", address: BEAN_CONTRACT, decimals: 18, native: false },
  JAI: { name: "JAI", address: JAI_CONTRACT, decimals: 6, native: false },
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

function readPrivateKeys() {
  try {
    const data = fs.readFileSync(WALLET_FILE, 'utf8');
    const privateKeys = data.split('\n')
      .map(key => key.trim())
      .filter(key => key !== '');
    
    return privateKeys;
  } catch (error) {
    console.error(`❌ Could not read file wallet.txt: ${error.message}`.red);
    process.exit(1);
  }
}

async function getRandomAmount(wallet, token, isToMON = false) {
  try {
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
  } catch (error) {
    console.error("❌ Error calculating random amount:".red, error);
    return ethers.utils.parseUnits("0.01", 18);
  }
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
    console.error(`❌ Error fetching token ${token.name} balance: ${error.message}`.red);
    return { raw: ethers.BigNumber.from(0), formatted: "0" };
  }
}

async function approveTokenIfNeeded(wallet, token, amount, routerAddress) {
  if (token.native) return true;
  
  try {
    const tokenContract = new ethers.Contract(token.address, ERC20_ABI, wallet);
    const allowance = await tokenContract.allowance(wallet.address, routerAddress);
    
    if (allowance.lt(amount)) {
      console.log(`⚙️ Approving token ${token.name}...`.cyan);
      const tx = await tokenContract.approve(routerAddress, ethers.constants.MaxUint256);
      console.log(`🚀 Approve Tx Sent! ${EXPLORER_URL}${tx.hash}`.yellow);
      await tx.wait();
      console.log(`✅ Token ${token.name} approved`.green);
    } else {
      console.log(`✅ Token ${token.name} already approved`.green);
    }
    return true;
  } catch (error) {
    console.error(`❌ Error approving token ${token.name}: ${error.message}`.red);
    return false;
  }
}

async function wrapMON(amount, wallet) {
  try {
    console.log(`🔄 Wrap ${ethers.utils.formatEther(amount)} MON → WMON...`.magenta);
    const wmonContract = new ethers.Contract(WMON_CONTRACT, WMON_ABI, wallet);
    const tx = await wmonContract.deposit({ value: amount, gasLimit: 500000 });
    console.log(`✔️ Wrap MON → WMON successful`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error wrapping MON:".red, error);
    return false;
  }
}

async function unwrapMON(amount, wallet) {
  try {
    console.log(`🔄 Unwrap ${ethers.utils.formatEther(amount)} WMON → MON...`.magenta);
    const wmonContract = new ethers.Contract(WMON_CONTRACT, WMON_ABI, wallet);
    const tx = await wmonContract.withdraw(amount, { gasLimit: 500000 });
    console.log(`✔️ Unwrap WMON → MON successful`.green.underline);
    console.log(`➡️ Transaction sent: ${EXPLORER_URL}${tx.hash}`.yellow);
    await tx.wait();
    return true;
  } catch (error) {
    console.error("❌ Error unwrapping WMON:".red, error);
    return false;
  }
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
    
    const routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, wallet);
    const currentTime = Math.floor(Date.now() / 1000);
    const deadline = currentTime + 6 * 3600;
    
    let path = [];
    if (tokenA.native) {
      path.push(WMON_CONTRACT);
    } else {
      path.push(tokenA.address);
    }
    
    if (tokenB.native) {
      path.push(WMON_CONTRACT);
    } else {
      path.push(tokenB.address);
    }
    
    let expectedOut, minAmountOut;
    try {
      const amountsOut = await routerContract.getAmountsOut(amountIn, path);
      expectedOut = amountsOut[amountsOut.length - 1];
      minAmountOut = expectedOut.mul(95).div(100);
    } catch (error) {
      console.error(`❌ Error fetching amountsOut for ${tokenA.name} → ${tokenB.name}: ${error.message}`.red);
      console.log(`⚠️ Possibly due to lack of liquidity or unsupported token pair. Trying a different pair.`.yellow);
      return false;
    }
    
    const formattedAmountIn = ethers.utils.formatUnits(amountIn, tokenA.decimals);
    const formattedAmountOut = ethers.utils.formatUnits(expectedOut, tokenB.decimals);
    
    console.log(`🔄 Swap ${formattedAmountIn} ${tokenA.name} → ${formattedAmountOut} ${tokenB.name}`.magenta);
    
    const feeData = await wallet.provider.getFeeData();
    const randomGasLimit = Math.floor(Math.random() * (350000 - 250000 + 1)) + 250000;
    const txOverrides = {
      gasLimit: randomGasLimit,
      maxFeePerGas: feeData.maxFeePerGas || feeData.gasPrice,
      maxPriorityFeePerGas: feeData.maxPriorityFeePerGas || feeData.gasPrice
    };
    
    let tx;
    try {
      if (tokenA.native) {
        tx = await routerContract.swapExactETHForTokens(
          minAmountOut,
          path,
          wallet.address,
          deadline,
          { value: amountIn, ...txOverrides }
        );
      } else if (tokenB.native) {
        tx = await routerContract.swapExactTokensForETH(
          amountIn,
          minAmountOut,
          path,
          wallet.address,
          deadline,
          txOverrides
        );
      } else {
        tx = await routerContract.swapExactTokensForTokens(
          amountIn,
          minAmountOut,
          path,
          wallet.address,
          deadline,
          txOverrides
        );
      }
      
      console.log(`🚀 Swap Tx Sent! ${EXPLORER_URL}${tx.hash}`.yellow);
      const receipt = await tx.wait();
      console.log(`✅ Swap ${tokenA.name} → ${tokenB.name} successful (Block ${receipt.blockNumber})`.green.underline);
      return true;
    } catch (error) {
      console.error(`❌ Error sending swap transaction ${tokenA.name} → ${tokenB.name}: ${error.message}`.red);
      return false;
    }
  } catch (error) {
    console.error(`❌ Error swapping ${tokenA.name} → ${tokenB.name}:`.red, error);
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

async function checkAndSwapToMON(wallet) {
  try {
    console.log(`🔍 Checking and swapping high-value tokens to MON...`.cyan);
    
    for (const tokenKey in availableTokens) {
      const token = availableTokens[tokenKey];
      if (token.native || token.name === "WMON") continue;
      
      const tokenBalance = await getTokenBalance(wallet, token);
      if (tokenBalance.raw.isZero()) continue;
      
      try {
        const routerContract = new ethers.Contract(ROUTER_CONTRACT, ROUTER_ABI, wallet);
        const path = [token.address, WMON_CONTRACT];
        const amountsOut = await routerContract.getAmountsOut(tokenBalance.raw, path);
        const estimatedMONValue = amountsOut[amountsOut.length - 1];
        const estimatedMONFormatted = ethers.utils.formatEther(estimatedMONValue);
        
        console.log(`💰 ${token.name} balance: ${tokenBalance.formatted} (≈ ${estimatedMONFormatted} MON)`.cyan);
        
        if (estimatedMONValue.gt(ethers.utils.parseEther("0.5"))) {
          console.log(`⚠️ Detected ${token.name} value greater than 0.5 MON, swapping to MON...`.yellow);
          
          const approveSuccess = await approveTokenIfNeeded(wallet, token, tokenBalance.raw, ROUTER_CONTRACT);
          if (!approveSuccess) {
            console.log(`❌ Could not approve token ${token.name}. Skipping this token.`.red);
            continue;
          }
          
          const amountToSwap = tokenBalance.raw.mul(99).div(100);
          const swapSuccess = await swapTokens(wallet, token, availableTokens.MON, amountToSwap, true);
          
          if (swapSuccess) {
            console.log(`✅ Successfully swapped ${token.name} to MON`.green);
          } else {
            console.log(`❌ Could not swap ${token.name} to MON`.red);
          }
        }
      } catch (error) {
        console.log(`⚠️ Error checking value of ${token.name}: ${error.message}`.yellow);
        continue;
      }
    }
    
    try {
      const wmonToken = availableTokens.WMON;
      const wmonBalance = await getTokenBalance(wallet, wmonToken);
      
      if (!wmonBalance.raw.isZero() && wmonBalance.raw.gt(ethers.utils.parseEther("0.5"))) {
        console.log(`💰 WMON balance: ${wmonBalance.formatted} (= ${wmonBalance.formatted} MON)`.cyan);
        console.log(`⚠️ Detected WMON value greater than 0.5 MON, unwrapping to MON...`.yellow);
        
        const amountToUnwrap = wmonBalance.raw.mul(99).div(100);
        const unwrapSuccess = await unwrapMON(amountToUnwrap, wallet);
        
        if (unwrapSuccess) {
          console.log(`✅ Successfully unwrapped WMON to MON`.green);
        } else {
          console.log(`❌ Could not unwrap WMON to MON`.red);
        }
      }
    } catch (error) {
      console.log(`⚠️ Error checking and unwrapping WMON: ${error.message}`.yellow);
    }
    
    const monBalance = await getTokenBalance(wallet, availableTokens.MON);
    console.log(`💰 MON balance after check: ${monBalance.formatted} MON`.cyan);
    
    return true;
  } catch (error) {
    console.error(`❌ Error checking and swapping tokens: ${error.message}`.red);
    return false;
  }
}

async function performSwapCycle(wallet, cycleNumber, totalCycles) {
  try {
    console.log(`Cycle ${cycleNumber} / ${totalCycles}:`.magenta);
    
    await checkAndSwapToMON(wallet);
    
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
        console.log(`❌ Could not continue with token ${tokenA.name}, trying a different pair`.yellow);
        return await retryWithDifferentPair(wallet, tokenA);
      }
    }
    
    const isToNative = tokenB.native;
    const randomAmount = await getRandomAmount(wallet, tokenA, isToNative);
    
    const swapSuccess = await swapTokens(wallet, tokenA, tokenB, randomAmount, isToNative);
    if (!swapSuccess) {
      console.log(`❌ Swap ${tokenA.name} → ${tokenB.name} failed, trying a different pair`.yellow);
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
        console.log(`⚠️ Could not perform reverse swap, but initial transaction succeeded`.yellow);
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
    
    await checkAndSwapToMON(wallet);
    
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
        console.log(`❌ Could not continue with token ${tokenA.name}`.yellow);
        return false;
      }
    }
    
    const isToNative = tokenB.native;
    const randomAmount = await getRandomAmount(wallet, tokenA, isToNative);
    
    return await swapTokens(wallet, tokenA, tokenB, randomAmount, isToNative);
  } catch (error) {
    console.error(`❌ Error retrying: ${error.message}`.red);
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

    const address = wallet.address;
    const truncatedAddress = `${address.substring(0, 6)}...${address.substring(address.length - 4)}`;
    console.log(`\n👤 Processing account: ${truncatedAddress}`.cyan);
    
    const balance = await wallet.getBalance();
    console.log(`💰 Balance: ${ethers.utils.formatEther(balance)} MON`.cyan);
    
    await checkAndSwapToMON(wallet);

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
    "How many cycles do you want to perform for each account? (Enter defaults to 1): ",
    (cycles) => {
      rl.question(
        "How often do you want each cycle to run (in hours)? (Press enter to run immediately): ",
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