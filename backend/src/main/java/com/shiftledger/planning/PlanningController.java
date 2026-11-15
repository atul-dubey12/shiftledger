package com.shiftledger.planning;

import java.math.BigDecimal;
import java.time.*;
import java.util.*;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.http.HttpStatus;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

/** Shares the same single-rider API-key protection as the ledger. Versioned writes prevent lost updates across devices. */
@RestController
@RequestMapping("/api")
public class PlanningController {
    private final JdbcTemplate db;
    public PlanningController(JdbcTemplate db) { this.db = db; }
    public record Payout(LocalDate weekStart, BigDecimal amount, LocalDate date, long version) {}
    public record Task(String id, String title, String kind, LocalDate dueDate, Integer dueKm,
                       BigDecimal estimatedCost, LocalDate completedOn, BigDecimal actualCost, long version) {}
    public record Bike(int odometer, long version) {}
    private static LocalDate today() { return LocalDate.now(ZoneId.of("Asia/Kolkata")); }
    private static void require(boolean condition, String message) {
        if (!condition) throw new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
    private static void conflict() { throw new ResponseStatusException(HttpStatus.CONFLICT, "Changed on another device. Refresh and review before saving again."); }
    private static boolean money(BigDecimal n) {
        return n != null && n.signum() >= 0 && n.compareTo(new BigDecimal("999999999")) <= 0 && n.stripTrailingZeros().scale() <= 2;
    }
    @GetMapping("/payouts") public List<Payout> payouts() {
        return db.query("SELECT * FROM weekly_payouts ORDER BY week_start DESC", (r, i) -> new Payout(r.getObject("week_start", LocalDate.class), r.getBigDecimal("amount"), r.getObject("received_on", LocalDate.class), r.getLong("version")));
    }
    @PutMapping("/payouts/{week}") public Payout payout(@PathVariable LocalDate week, @RequestBody Payout p) {
        require(p != null && week.getDayOfWeek() == DayOfWeek.MONDAY && !week.plusDays(7).isAfter(today()), "Choose a completed Monday–Sunday week.");
        require(money(p.amount()) && p.date() != null && !p.date().isBefore(week.plusDays(7)) && !p.date().isAfter(today()) && p.version() >= 0, "Enter a valid amount and received date on or after payday, no later than today.");
        try {
            if (p.version() == 0) db.update("INSERT INTO weekly_payouts (week_start,amount,received_on,version) VALUES (?,?,?,1)", week,p.amount(),p.date());
            else if (db.update("UPDATE weekly_payouts SET amount=?,received_on=?,version=version+1 WHERE week_start=? AND version=?",p.amount(),p.date(),week,p.version()) != 1) conflict();
        } catch (DuplicateKeyException e) { conflict(); }
        return new Payout(week,p.amount(),p.date(),p.version()+1);
    }
    @GetMapping("/maintenance") public List<Task> tasks() {
        return db.query("SELECT * FROM maintenance_items ORDER BY title,id", (r,i) -> new Task(r.getString("id"),r.getString("title"),r.getString("kind"),r.getObject("due_date",LocalDate.class),r.getObject("due_km",Integer.class),r.getBigDecimal("estimated_cost"),r.getObject("completed_on",LocalDate.class),r.getBigDecimal("actual_cost"),r.getLong("version")));
    }
    @PutMapping("/maintenance/{id}") public Task task(@PathVariable String id, @RequestBody Task t) {
        require(id.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"), "Invalid maintenance identifier.");
        require(t != null && t.title() != null && !t.title().isBlank() && t.title().trim().length() <= 120 && t.version() >= 0, "Enter a title up to 120 characters.");
        require(t.kind() != null && Set.of("SERVICE","OIL","INSURANCE","OTHER").contains(t.kind()), "Choose a maintenance type.");
        require(t.dueDate() != null || t.dueKm() != null, "Enter a due date or odometer reading.");
        require(t.dueKm() == null || (t.dueKm() >= 0 && t.dueKm() <= 9999999), "Invalid due kilometres.");
        require((t.estimatedCost() == null || money(t.estimatedCost())) && (t.actualCost() == null || money(t.actualCost())), "Enter valid costs with up to two decimals.");
        require((t.completedOn() == null && t.actualCost() == null) || (t.completedOn() != null && !t.completedOn().isAfter(today())), "Completion date cannot be in the future; actual cost requires completion.");
        try {
            if (t.version() == 0) db.update("INSERT INTO maintenance_items (id,title,kind,due_date,due_km,estimated_cost,completed_on,actual_cost,version) VALUES (?,?,?,?,?,?,?,?,1)",id,t.title().trim(),t.kind(),t.dueDate(),t.dueKm(),t.estimatedCost(),t.completedOn(),t.actualCost());
            else if (db.update("UPDATE maintenance_items SET title=?,kind=?,due_date=?,due_km=?,estimated_cost=?,completed_on=?,actual_cost=?,version=version+1 WHERE id=? AND version=?",t.title().trim(),t.kind(),t.dueDate(),t.dueKm(),t.estimatedCost(),t.completedOn(),t.actualCost(),id,t.version()) != 1) conflict();
        } catch (DuplicateKeyException e) { conflict(); }
        return new Task(id,t.title().trim(),t.kind(),t.dueDate(),t.dueKm(),t.estimatedCost(),t.completedOn(),t.actualCost(),t.version()+1);
    }
    @DeleteMapping("/maintenance/{id}") @ResponseStatus(HttpStatus.NO_CONTENT)
    public void delete(@PathVariable String id, @RequestParam long version) {
        if (db.update("DELETE FROM maintenance_items WHERE id=? AND version=?",id,version) != 1) conflict();
    }
    @GetMapping("/bike") public Bike bike() {
        return db.query("SELECT * FROM bike_state WHERE id=1", (r,i) -> new Bike(r.getInt("odometer"),r.getLong("version"))).stream().findFirst().orElse(new Bike(0,0));
    }
    @PutMapping("/bike") public Bike bike(@RequestBody Bike b) {
        require(b != null && b.odometer() >= 0 && b.odometer() <= 9999999 && b.version() >= 0, "Enter an odometer reading between 0 and 9999999.");
        try {
            if (b.version() == 0) db.update("INSERT INTO bike_state (id,odometer,version) VALUES (1,?,1)",b.odometer());
            else if (db.update("UPDATE bike_state SET odometer=?,version=version+1 WHERE id=1 AND version=?",b.odometer(),b.version()) != 1) conflict();
        } catch (DuplicateKeyException e) { conflict(); }
        return new Bike(b.odometer(),b.version()+1);
    }
}
