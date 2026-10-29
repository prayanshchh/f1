install(FILES
    car.xml
    human.xml
    logo.png
    logo.rgb
    preferences.xml
    DESTINATION ${datadir}/drivers/human
)

add_subdirectory(cars)
