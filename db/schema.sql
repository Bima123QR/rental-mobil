
DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS cars;

CREATE TABLE cars (
  id            SERIAL PRIMARY KEY,
  name          VARCHAR(80)  NOT NULL,
  category      VARCHAR(30)  NOT NULL,
  seats         INT          NOT NULL CHECK (seats > 0),
  transmission  VARCHAR(10)  NOT NULL DEFAULT 'Manual',
  fuel          VARCHAR(20)  NOT NULL DEFAULT 'Bensin',
  price_per_day INT          NOT NULL CHECK (price_per_day > 0),
  driver_fee    INT          NOT NULL DEFAULT 200000,
  image_url     TEXT,
  is_active     BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE TABLE bookings (
  id            SERIAL PRIMARY KEY,
  code          VARCHAR(12)  NOT NULL UNIQUE,
  car_id        INT          NOT NULL REFERENCES cars(id),
  customer_name VARCHAR(80)  NOT NULL,
  phone         VARCHAR(20)  NOT NULL,
  start_date    DATE         NOT NULL,
  end_date      DATE         NOT NULL,
  with_driver   BOOLEAN      NOT NULL DEFAULT FALSE,
  notes         TEXT,
  total_price   INT          NOT NULL,
  status        VARCHAR(12)  NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending','confirmed','done','cancelled')),
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW(),
  CHECK (end_date >= start_date)
);
CREATE INDEX idx_bookings_car_dates ON bookings(car_id, start_date, end_date);
CREATE INDEX idx_bookings_phone ON bookings(phone);

INSERT INTO cars (name, category, seats, transmission, fuel, price_per_day, driver_fee) VALUES
('Porsche 911 Carrera S','Sport',4,'Otomatis','Bensin',6500000,1000000),
('BMW M4 Competition','Sport',4,'Otomatis','Bensin',4500000,900000),
('Mercedes-AMG GT 63','Sport',4,'Otomatis','Bensin',7500000,1000000),
('Audi R8 V10','Supercar',2,'Otomatis','Bensin',9000000,1200000),
('Lamborghini Huracan','Supercar',2,'Otomatis','Bensin',15000000,1500000),
('Ferrari Roma','Grand Tourer',4,'Otomatis','Bensin',14000000,1500000),
('McLaren 720S','Supercar',2,'Otomatis','Bensin',18000000,1500000),
('Bentley Continental GT','Grand Tourer',4,'Otomatis','Bensin',12000000,1500000);
