package com.shiftledger.entry;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/api/entries")
@CrossOrigin(origins = "http://localhost:4200")
public class EntryController {
    private static final BigDecimal MAX_HOURS = BigDecimal.valueOf(24);
    private final EntryRepository repository;

    public EntryController(EntryRepository repository) { this.repository = repository; }

    @GetMapping
    public List<Entry> all(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                           @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        if (from == null && to == null) return repository.findAllByOrderByDateDescIdDesc();
        return repository.findByDateBetweenOrderByDateDescIdDesc(from == null ? LocalDate.of(2000, 1, 1) : from,
                to == null ? LocalDate.of(2999, 12, 31) : to);
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public Entry create(@RequestBody EntryRequest request) {
        validate(request);
        return repository.save(new Entry(request, clean(request.note())));
    }

    @PutMapping("/{id}")
    public Entry update(@PathVariable Long id, @RequestBody EntryRequest request) {
        validate(request);
        Entry entry = repository.findById(id).orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND));
        entry.apply(request, clean(request.note()));
        return repository.save(entry);
    }

    @DeleteMapping("/{id}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable Long id) {
        if (!repository.existsById(id)) throw new ResponseStatusException(HttpStatus.NOT_FOUND);
        repository.deleteById(id);
    }

    @GetMapping(value = "/export", produces = "text/csv")
    public ResponseEntity<String> export(@RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
                                         @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {
        StringBuilder csv = new StringBuilder("Date,Type,Category,Amount,Orders,Hours,Km,Note,COD,PaidFrom,SettlementMethod\n");
        for (Entry e : all(from, to)) {
            csv.append(e.getDate()).append(',').append(e.getType()).append(',')
                    .append(e.getCategory() == null ? "" : e.getCategory()).append(',')
                    .append(e.getAmount().toPlainString()).append(',')
                    .append(e.getOrderCount() == null ? "" : e.getOrderCount()).append(',')
                    .append(e.getHoursWorked() == null ? "" : e.getHoursWorked().toPlainString()).append(',')
                    .append(e.getDistanceKm() == null ? "" : e.getDistanceKm().toPlainString()).append(',')
                    .append(csvCell(e.getNote())).append(',')
                    .append(e.getCodAmount() == null ? "" : e.getCodAmount().toPlainString()).append(',')
                    .append(e.getPaidFrom() == null ? "" : e.getPaidFrom()).append(',')
                    .append(e.getSettlementMethod() == null ? "" : e.getSettlementMethod()).append('\n');
        }
        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"shiftledger-" + LocalDate.now() + ".csv\"")
                .contentType(MediaType.parseMediaType("text/csv; charset=UTF-8"))
                .body(csv.toString());
    }

    private void validate(EntryRequest request) {
        if (request.type() == null || request.amount() == null || request.date() == null) throw badRequest("Type, amount, and date are required.");
        // A COD order whose payout isn't known yet, or an end-of-shift entry that only records hours, may carry ₹0.
        boolean zeroAllowed = request.type() == EntryType.INCOME && (positive(request.codAmount()) || positive(request.hoursWorked()));
        if (request.amount().signum() < 0 || (request.amount().signum() == 0 && !zeroAllowed)) throw badRequest("Enter an amount greater than ₹0.");
        if (request.amount().compareTo(BigDecimal.valueOf(10_000_000)) >= 0) throw badRequest("Amount is too large.");
        if (request.date().isAfter(LocalDate.now().plusDays(1))) throw badRequest("Date cannot be in the future.");
        boolean hasShiftDetails = request.orderCount() != null || request.hoursWorked() != null || request.distanceKm() != null;
        switch (request.type()) {
            case INCOME -> {
                if (request.category() != null) throw badRequest("Income entries do not have an expense category.");
                if (request.paidFrom() != null) throw badRequest("Only expenses can be paid from COD cash.");
            }
            case EXPENSE -> {
                if (request.category() == null) throw badRequest("Choose an expense category.");
                if (hasShiftDetails) throw badRequest("Orders, hours and distance belong on shift earnings.");
                if (request.codAmount() != null) throw badRequest("COD cash is recorded on orders, not expenses.");
            }
            case COD_SETTLEMENT -> {
                if (request.settlementMethod() == null) throw badRequest("Choose how the COD cash was settled.");
                if (request.category() != null || hasShiftDetails || request.codAmount() != null || request.paidFrom() != null) {
                    throw badRequest("A COD settlement only has an amount, date, method and note.");
                }
            }
        }
        if (request.type() != EntryType.COD_SETTLEMENT && request.settlementMethod() != null) throw badRequest("Settlement method only applies to COD settlements.");
        if (request.codAmount() != null && (request.codAmount().signum() < 0 || request.codAmount().compareTo(BigDecimal.valueOf(100_000)) >= 0)) {
            throw badRequest("COD cash must be between ₹0 and ₹1,00,000.");
        }
        if (request.orderCount() != null && (request.orderCount() < 0 || request.orderCount() > 500)) throw badRequest("Orders must be between 0 and 500.");
        if (request.hoursWorked() != null && (request.hoursWorked().signum() < 0 || request.hoursWorked().compareTo(MAX_HOURS) > 0)) {
            throw badRequest("Hours must be between 0 and 24.");
        }
        if (request.distanceKm() != null && (request.distanceKm().signum() < 0 || request.distanceKm().compareTo(BigDecimal.valueOf(2000)) > 0)) {
            throw badRequest("Distance must be between 0 and 2000 km.");
        }
    }

    private static boolean positive(BigDecimal value) { return value != null && value.signum() > 0; }

    private static ResponseStatusException badRequest(String message) { return new ResponseStatusException(HttpStatus.BAD_REQUEST, message); }

    private static String csvCell(String value) {
        if (value == null) return "";
        String safe = value.matches("^[=+\\-@].*") ? "'" + value : value;
        return "\"" + safe.replace("\"", "\"\"") + "\"";
    }

    private String clean(String note) {
        if (note == null || note.isBlank()) return null;
        return note.trim().substring(0, Math.min(note.trim().length(), 180));
    }
}
