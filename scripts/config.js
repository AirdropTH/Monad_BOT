module.exports = {
    // Transaction amount limits as percentages of wallet balance
    transactionLimits: {
      minPercentage: 0.1, // Default: 0,1% of balance
      maxPercentage: 1, // Default: 1% of balance
    },
    
    // Minimum transaction amount in ETH (fallback if calculated amount is too small)
    minimumTransactionAmount: "0.0001",
    
    // Default amount in ETH (used if there's an error calculating the random amount)
    defaultTransactionAmount: "0.01"
  };