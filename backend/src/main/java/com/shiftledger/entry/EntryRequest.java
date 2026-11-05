package com.shiftledger.entry;

import java.math.BigDecimal;
import java.time.LocalDate;

public record EntryRequest(EntryType type, ExpenseCategory category, BigDecimal amount, LocalDate date, String note,
                           Integer orderCount, BigDecimal hoursWorked, BigDecimal distanceKm,
                           BigDecimal codAmount, PaidFrom paidFrom, SettlementMethod settlementMethod) {}
