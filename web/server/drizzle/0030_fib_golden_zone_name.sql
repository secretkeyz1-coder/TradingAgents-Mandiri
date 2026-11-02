-- Custom SQL migration file, put your code below! --
-- The catalog seeded the Fibonacci engine as "Fib GZ" while its signal messages, the public record and
-- the chart call it "Fib Golden Zone"; a built-in's name is not the admin's to change, so it changes here.
UPDATE "indicators" SET "name" = 'Fib Golden Zone' WHERE "builtin" = 'fib' AND "name" = 'Fib GZ';
