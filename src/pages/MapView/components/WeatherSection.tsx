import { ArrowUp } from "lucide-react";
import { WindForecast, weatherEmoji } from "../../../services/nws";
import { degreesToCompass } from "../../../lib/format";
import Section from "./Section";

export default function WeatherSection({ weather }: { weather: WindForecast | null }) {
  return (
    <Section title="Weather">
      {weather ? (
        <>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Forecast</span>
            <span className="font-medium">
              {weather.shortForecast}
              {weatherEmoji(weather.shortForecast, weather.isDaytime) && (
                // Decorative: the text beside it says the same thing.
                <span aria-hidden="true" className="ml-1.5">
                  {weatherEmoji(weather.shortForecast, weather.isDaytime)}
                </span>
              )}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Temperature</span>
            <span className="font-medium">{weather.temperatureF}°F</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Wind</span>
            <span className="font-medium flex items-center gap-1">
              {(weather.speedKnots / 0.868976).toFixed(0)} mph{" "}
              {weather.windDirectionLabel || degreesToCompass(weather.directionDeg)}
              <ArrowUp
                size={14}
                className="inline-block"
                style={{
                  transform: `rotate(${weather.directionDeg + 180}deg)`,
                }}
              />
            </span>
          </div>
        </>
      ) : (
        <div className="text-xs text-muted-foreground italic">Loading weather...</div>
      )}
    </Section>
  );
}
