package com.shiftledger.entry;

import jakarta.persistence.*;
import java.math.BigDecimal;
import java.time.LocalDate;

@Entity
@Table(name = "entries")
public class Entry {
    @Id @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;
    @Enumerated(EnumType.STRING) @Column(nullable = false, length = 20, columnDefinition = "varchar(20)")
    private EntryType type;
    @Enumerated(EnumType.STRING) @Column(length = 30, columnDefinition = "varchar(30)")
    private ExpenseCategory category;
    @Column(nullable = false, precision = 10, scale = 2)
    private BigDecimal amount;
    @Column(nullable = false)
    private LocalDate date;
    @Column(length = 180)
    private String note;
    private Integer orderCount;
    @Column(precision = 5, scale = 2)
    private BigDecimal hoursWorked;
    @Column(precision = 7, scale = 1)
    private BigDecimal distanceKm;

    protected Entry() {}

    public Entry(EntryRequest request, String note) { apply(request, note); }

    public void apply(EntryRequest request, String note) {
        this.type = request.type();
        this.category = request.category();
        this.amount = request.amount();
        this.date = request.date();
        this.note = note;
        this.orderCount = request.orderCount();
        this.hoursWorked = request.hoursWorked();
        this.distanceKm = request.distanceKm();
    }

    public Long getId() { return id; }
    public EntryType getType() { return type; }
    public ExpenseCategory getCategory() { return category; }
    public BigDecimal getAmount() { return amount; }
    public LocalDate getDate() { return date; }
    public String getNote() { return note; }
    public Integer getOrderCount() { return orderCount; }
    public BigDecimal getHoursWorked() { return hoursWorked; }
    public BigDecimal getDistanceKm() { return distanceKm; }
}
