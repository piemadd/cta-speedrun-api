const fetch = require('node-fetch');
const express = require('express');
const { parse } = require('csv-parse/sync');

require('dotenv').config();

const app = express();

let trip = [];
let liveLocations = {};

const parseBusDate = (date) => {
  //example 20230202 03:36
  const year = date.substring(0, 4);
  const month = date.substring(4, 6);
  const day = date.substring(6, 8);
  const hour = date.substring(9, 11);
  const minute = date.substring(11, 13);
  return new Date(`${year}-${month}-${day}T${hour}:${minute}:00-06:00`);
}

const fetchTripData = async () => {
  console.log('updating trip data')
  fetch('https://docs.google.com/spreadsheets/d/e/2PACX-1vT6WGmf9kubHJfoVWYPQPC-OdnMhK1xUSldie0ZPeMOpdFI2NsL_3DeJeMwoJcXyzRDshTTgn5z67Vz/pub?output=csv', { cache: "reload" })
    .then(res => res.text())
    .then(body => {
      console.log('trip data fetched, parsing')
      const records = parse(body, {
        columns: true,
        skip_empty_lines: true
      });

      trip = records.map(record => {
        return {
          segment_name: record.segment_name,
          segment_id: record.segment_id,
          segment_line: record.segment_line,
          start_station_name: record.start_station_name,
          start_station_id: Number(record.start_station_id),
          end_station_name: record.end_station_name,
          end_station_id: Number(record.end_station_id),
          departure: Number(record.departure),
          arrival: Number(record.arrival),
          vehicle_id: Number(record.vehicle_id),
        };
      });;

      console.log('updated trip data!')
    });

  setTimeout(fetchTripData, 1000 * 60);
};

const getLiveLocation = async () => {
  console.log('updating live locations')
  trip.forEach((section) => {
    if (section.vehicle_id === 0) return; // skip if there is no vehicle id
    if (section.departure === 0) return; // skip if the segment hasnt started (should be caught by line above)
    if (section.arrival !== 0) return; // skip if the segment has ended

    if (section.segment_line.startsWith('bus')) {
      console.log('bus')
      fetch(`http://www.ctabustracker.com/bustime/api/v2/getpredictions?key=${process.env.CTA_BUS_KEY}&format=json&stpid=${section.end_station_id}`)
        .then((res) => res.json())
        .then((body) => {
          if (body['bustime-response'].prd && body['bustime-response'].prd.length > 0) {
            console.log('found bus', section.vehicle_id)
            body['bustime-response'].prd.forEach((bus) => {
              if (Number(bus.vid) == section.vehicle_id) {
                liveLocations[section.segment_id] = {
                  vehicle_id: Number(bus.vid),
                  segment_line: section.segment_line.split('_')[1],
                  arrival: parseBusDate(bus.prdtm),
                  end_station_id: section.end_station_id,
                  end_station_name: section.end_station_name,
                };
              };
            })
          };
        });
    } else if (section.segment_line.startsWith('pace')) {
      console.log('pace')
      return;
    } else if (section.segment_line.startsWith('train')) { //cta train
      console.log('train')
      fetch(`http://lapi.transitchicago.com/api/1.0/ttarrivals.aspx?mapid=${section.end_station_id}&key=${process.env.CTA_TRAIN_KEY}&outputType=JSON`)
        .then((res) => res.json())
        .then((body) => {
          if (body.ctatt.eta && body.ctatt.eta.length > 0) {
            body.ctatt.eta.forEach((train) => {
              console.log(train.rn, section.vehicle_id, train.isSch)
              if (train.rn == section.vehicle_id && train.isSch == 0) {
                console.log('found train', section.vehicle_id)
                liveLocations[section.segment_id] = {
                  vehicle_id: section.vehicle_id,
                  segment_line: section.segment_line.split('_')[1],
                  arrival: new Date(new Date(train.arrT).valueOf() + (1000 * 60 * 60 * 6)),
                  end_station_id: section.end_station_id,
                  end_station_name: section.end_station_name,
                };
              };
            })
          }
        });
    }
  })

  setTimeout(getLiveLocation, 1000 * 60);
};

app.get('/', (req, res) => {
  res.send('hiiiii')
});

app.get('/trip', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.json(trip);
});

app.get('/live', (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', '*');
  res.json(liveLocations);
});

fetchTripData().then(() => {
  getLiveLocation();
  app.listen(3000, () => console.log('Listening on port 3000'));
})
