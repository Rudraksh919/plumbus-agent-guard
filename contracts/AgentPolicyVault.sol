// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract AgentPolicyVault is Ownable {
    using SafeERC20 for IERC20;

    IERC20 public immutable plumbus;
    address public agent;
    address public approvedRecipient;
    uint256 public maxTransferAmount;

    event PolicyUpdated(address indexed agent, address indexed recipient, uint256 maxTransferAmount);
    event AgentTransfer(address indexed recipient, uint256 amount);

    error NotAgent();
    error RecipientNotApproved();
    error AmountExceedsPolicy();

    constructor(IERC20 plumbus_, address agent_, address recipient_, uint256 maxTransferAmount_)
        Ownable(msg.sender)
    {
        plumbus = plumbus_;
        _setPolicy(agent_, recipient_, maxTransferAmount_);
    }

    function setPolicy(address agent_, address recipient_, uint256 maxTransferAmount_) external onlyOwner {
        _setPolicy(agent_, recipient_, maxTransferAmount_);
    }

    function executeTransfer(address recipient, uint256 amount) external {
        if (msg.sender != agent) revert NotAgent();
        if (recipient != approvedRecipient) revert RecipientNotApproved();
        if (amount > maxTransferAmount) revert AmountExceedsPolicy();

        plumbus.safeTransfer(recipient, amount);
        emit AgentTransfer(recipient, amount);
    }

    function _setPolicy(address agent_, address recipient_, uint256 maxTransferAmount_) private {
        require(agent_ != address(0) && recipient_ != address(0), "zero address");
        agent = agent_;
        approvedRecipient = recipient_;
        maxTransferAmount = maxTransferAmount_;
        emit PolicyUpdated(agent_, recipient_, maxTransferAmount_);
    }
}