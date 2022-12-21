const { getNamedAccounts, ethers, network } = require("hardhat")
const { networkConfig } = require("../helper-hardhat-config")
const { getWeth, AMOUNT } = require("../scripts/getWeth")

async function main() {
    // protocol treats everything as ERC20 token
    await getWeth()
    const { deployer } = await getNamedAccounts()
    // Need to interact with AAVE protocol === need ABI. address
    // LendingPoolAddressProvider: 0x5E52dEc931FFb32f609681B8438A51c675cc232d
    // LendingPool: ^^^

    const lendingPool = await getLendingPool(deployer)
    console.log(`Lending Pool found at ${lendingPool.address}`)

    // deposit --> 1st need to approve AAVE contract to get WETH token
    const wethTokenAddress =
        networkConfig[network.config.chainId].lendingPoolAddressesProvider
    // approve
    await approveERC20(wethTokenAddress, lendingPool.address, AMOUNT, deployer)
    console.log("Depositing....")
    await lendingPool.deposit(wethTokenAddress, AMOUNT, deployer, 0)
    console.log("-----Deposited-----")

    // ------------------------------------ BORROW TIME! ------------------------------------ \\
    /*
    -> How much we have already borrowed
    -> How much collateral do we have
    -> How much we can borrow
    ==> we will use AAVE fn -> getUSerAccountData() === to get data of user across all reserves
    */
    let { availableBorrowsETH, totalDebtETH } = await getBorrowUserData(
        lendingPool,
        deployer
    )
    // Exchange rate of DAI -> ETH
    const daiPrice = await getDaiPrice()
    const amountDaiToBorrow =
        availableBorrowsETH.toString() * 0.95 * (1 / daiPrice.toNumber()) // 0.95 => we can borrow only 95% of what we can actually borrow => this is needed so that we won't hit UPPER_BORROW_LIMIT
    console.log(`You can borrow ${amountDaiToBorrow} DAI`)
    const amountDaiToBorrowWei = ethers.utils.parseEther(
        amountDaiToBorrow.toString()
    )
    console.log(`You can borrow ${amountDaiToBorrowWei} WEI`)

    // Borrowing DAI
    await borrowDai(
        networkConfig[network.config.chainId].daiToken,
        lendingPool,
        amountDaiToBorrowWei,
        deployer
    )

    await getBorrowUserData(lendingPool, deployer) // To keep a track of borrowing

    // ------------------------------------ REPAY TIME! ------------------------------------ \\

    repay(
        networkConfig[network.config.chainId].daiToken,
        amountDaiToBorrowWei,
        lendingPool,
        deployer
    )
    // here we're Returning ALL th DAI we owe BUT we still have miger amount of DAI in our possesion AS WE OWE ""INTEREST"" for borrowing DAI
    await getBorrowUserData(lendingPool, deployer) // To keep a track of borrowing
}

//-----------------------------------------------------------------------------------------------------------\\

async function repay(daiAddress, amount, lendingPool, account) {
    // to repay 1st we need to approve sending our DAI back to AAVE
    await approveERC20(daiAddress, lendingPool.address, amount, account)
    const repayTx = await lendingPool.repay(daiAddress, amount, 1, account)
    await repayTx.wait(1)

    console.log("Repaid")
}

//-----------------------------------------------------------------------------------------------------------\\

async function borrowDai(
    daiAddress,
    lendingPool,
    amountDaiTOBorrowWei,
    account
) {
    const borrowTx = await lendingPool.borrow(
        daiAddress,
        amountDaiTOBorrowWei,
        1 /* Interest Rate === 1-> Stable| 0-> Unstable */,
        0 /* Referal code */,
        account
    )
    await borrowTx.wait(1)
    console.log("You've borrowed!!")
}

//-----------------------------------------------------------------------------------------------------------\\

async function getDaiPrice() {
    const daiETHPriceFeed = await ethers.getContractAt(
        "AggregatorV3Interface",
        networkConfig[network.config.chainId].daiETHPriceFeed
        /* NO need to connect with "deployer" as We're just reading from this contract AND not sending any txn*/
    )

    const price = (
        await daiETHPriceFeed.latestRoundData()
    )[1] /* We only want 1st Index */
    console.log(`The DAI/ETH price feed => ${price.toString()}`)
}

//-----------------------------------------------------------------------------------------------------------\\

async function getBorrowUserData(lendingPool, account) {
    const {
        totalCollateralETH,
        totalDebtETH,
        availableBorrowsETH,
        healthFactor,
    } = await lendingPool.getUserAccountData()

    console.log(`You have ${totalCollateralETH} ETH deposited.`)
    console.log(`You have borrowed ${totalDebtETH} ETH.`)
    console.log(`You can borrow ${availableBorrowsETH} ETH.`)
    console.log(`Your Health-Factor = ${healthFactor} ETH.`)

    return { availableBorrowsETH, totalDebtETH }
}

//-----------------------------------------------------------------------------------------------------------\\

async function getLendingPool(account) {
    // We need to interact with "LendingPoolAddressProvider" to get "LendingPool"
    // address✅ , ABI✅
    const lendingPoolAddressesProvider = await ethers.getContractAt(
        "ILendingPoolAddressesProvider",
        networkConfig[network.config.chainId].lendingPoolAddressesProvider,
        account /* This is gonna be DEPLOYER */
    )

    const lendingPoolAddress =
        await lendingPoolAddressesProvider.getLendingPool()

    const lendingPool = await ethers.getContract(
        "ILendingPool",
        lendingPoolAddress,
        account
    )

    return lendingPool
}

//-----------------------------------------------------------------------------------------------------------\\

async function approveERC20(
    erc20Address,
    spenderAddress /* One who is allowed to spend money*/,
    amountToSpend,
    account
) {
    const erc20Token = await ethers.getContractAt(
        "IERC20",
        erc20Address,
        account
    )

    const tx = await erc20Address.approve(spenderAddress, amountToSpend)
    await tx.wait(1)
    console.log("Approved")
}

//-----------------------------------------------------------------------------------------------------------\\

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error)
        process.exit(1)
    })
