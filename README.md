# Navigator

https://navigator.seanc.how

This project is an attempt to create a serverless float planner for the Village Community Boathouse and other NYC based boathouses.

I originally tried this project when I first learned web development and failed miserably because calculating routes in bodies of water is hard thanks to their fluid nature (🥁). At the time I created a node at the first coordinate the user would select and created a graph that would radially fan out from that point to find the next point. I then made a request to Google Map's images API, painted the map into Canvas and checked whether the color of the pixel at that coordinate was blue, if so I assumed it was water.

In retrospect very naive but I might look back a few years from now and consider this not very sophisticated.

## Why?

Creating a rowing float plan is critical before heading out onto the water. Misjudging the tide and having to fight the current can cause crews to get stranded for hours waiting for the tide to shift. All the information is readily available but we've long used paper maps to calculate routes, the tedious nature can cause planners to cut corners or simply make mistakes, the consequences of which can range from dangerous to annoying.

## What?

This app allows the user to place markers on a map of NYC and it will do it's best to calculate the most direct path between those points while giving a little buffer from the shoreline. Once the path is determined the app will call various NOAA API's to get tidal and weather information and calculate it's effects on the user's drawn path. Then depending on the user's estimated average speed and vessel type it will give estimates on total distance and time.

## Where

To limit scope I've started this project to only work in the water around NYC. If you row somewhere else in the world and would like functionality there please contact me.

### Known Issues

The app treats Roosevelt Island as water.
The app treats DeGraw Street in Brooklyn as water.

## How?

Navigator allows a user to input their departure time and date, their vessel type and their estimated average speed. Once it collects that information it makes an API call to NOAA to retrieve tidal and weather information.

Navigator loads an interactive map using MapLibre GL and allows users to enters coordinate points that will make up their float plan. The app sends those points to a WASM task running in a parallel web worker that loads a graph of the waterways of New York. It uses A* to calculate the most effecient path and returns the coordinates that make up that route to the main thread. The main thread then paints the returned route to the map and uses the queried tidal and weather data to give the user an estimate for thier float plan distance and duration.

In my previous attempts to create this app the bottleneck was building the graph and calculating the path. Precomputing the graph and handling the pathfinding in WASM has made this a much smoother experience.


## When

Now!
