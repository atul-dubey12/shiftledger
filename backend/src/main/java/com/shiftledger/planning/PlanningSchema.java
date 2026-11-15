package com.shiftledger.planning;

import javax.sql.DataSource;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.ApplicationArguments;
import org.springframework.context.annotation.Profile;
import org.springframework.core.io.ClassPathResource;
import org.springframework.jdbc.datasource.init.ResourceDatabasePopulator;
import org.springframework.stereotype.Component;

@Component
@Profile("!prod")
class PlanningSchema implements ApplicationRunner {
    private final DataSource dataSource;
    PlanningSchema(DataSource dataSource) { this.dataSource = dataSource; }
    public void run(ApplicationArguments args) {
        new ResourceDatabasePopulator(new ClassPathResource("db/migration/V3__payouts_maintenance.sql")).execute(dataSource);
    }
}
