// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockPlumbus is ERC20 {
    constructor() ERC20("Plumbus", "PLUMBUS") {}

    function mint(address account, uint256 amount) external {
        _mint(account, amount);
    }
}